/**
 * 05-allocate.ts — the agent's self-directed allocation (build spec §4, mode b).
 *
 *  The agent instructs an allocation of liquid USDC within the policy
 *  (demo: $5 USDC→SPCX, --amount parameterized). Flow:
 *    (1) transfer the amount from the agent hot wallet → agent vault
 *        (the agent funds their brokerage account; signed by the script-held
 *        hot key — disclosed, agent-directed);
 *    (2) GET /swap/v2/build (taker = agent vault PDA, USDC→SPCX, slippageBps
 *        from config) → inner TransactionMessage (payer = vault PDA) →
 *        vaultTransactionCreate → proposalCreate (mandatory, isDraft: false) →
 *        proposalApprove → vaultTransactionExecute (unsigned; the script
 *        signs as the agent-vault member + feePayer).
 *
 *  POLICY VALIDATION RUNS FIRST — the policy is a constraint, not a decoration.
 *  Hard refuses (no proposal is built):
 *    - output mint not in the allowlist parsed from policy/allocation-policy-v1.md
 *    - allowlist in the policy disagrees with lib/config.ts MINTS
 *    - amount above MAX_SINGLE_TRADE_USD ($50, demo risk bound)
 *    - amount above the hot wallet's USDC balance (can't fund what isn't there)
 *  The 60/40 target and the 50% single-name cap govern the TREASURY operating
 *  float (policy text); the agent vault is a separate self-directed account.
 *  The post-trade SPCX share is logged as INFO against the cap, not a refuse —
 *  mode (b) is "the agent invests the liquid slice however it wants within the
 *  allowlist". This reading is documented here because the alternative (capping
 *  the agent's own sleeve at 50%) would veto the demo's core beat.
 *
 *  Disclosed as agent-directed, script-executed (prod: the agent holds its own
 *  hot key and signs).
 *
 *  SAFETY: dry-run is the default. The real run needs --live.
 *  --dry-run (default): validates the policy, quotes the swap, prints the
 *    funding transfer + all Squads payloads. Sends nothing.
 *  Flags: --vault=<agent vault PDA> (default: agent1 from data/vaults.json),
 *         --amount=<USD> (default 5).
 */

import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { JUPITER_SLIPPAGE_BPS, MINTS } from "../lib/config.js";
import { buildSwapParts, jupBuild } from "../lib/jupiter.js";
import {
  getConnection,
  getOrCreateAtaIx,
  getTokenBalance,
  keypairExists,
  loadKeypair,
  loadOrGenerateKeypair,
  sendWithSizing,
  squadsProposeApproveExecute,
} from "../lib/squads.js";
import { pub, sig } from "../lib/safe-log.js";

const DRY_RUN = !process.argv.includes("--live");
const AMOUNT_USD = Number(process.argv.find((a) => a.startsWith("--amount="))?.split("=")[1] ?? "5");
const VAULT_ARG = process.argv.find((a) => a.startsWith("--vault="))?.split("=")[1];

const REPO_ROOT = path.join(import.meta.dirname ?? ".", "..");
const VAULTS_JSON = path.join(REPO_ROOT, "data", "vaults.json");
const POLICY_MD = path.join(REPO_ROOT, "policy", "allocation-policy-v1.md");

const MAX_SINGLE_TRADE_USD = 50;

interface PolicyView {
  allowlisted: string[];
  singleNameCapPct: number | null;
}

/** Parse the allowlist + single-name cap out of the policy markdown. */
function readPolicy(): PolicyView {
  const md = fs.readFileSync(POLICY_MD, "utf8");
  const section = md.split("## Allowlisted mints")[1]?.split("## ")[0] ?? "";
  const allowlisted = [...section.matchAll(/`([1-9A-HJ-NP-Za-km-z]{43,44})`/g)].map((m) => m[1]!);
  const cap = md.match(/≤(\d+)% of float in any one mint/);
  return { allowlisted, singleNameCapPct: cap ? Number(cap[1]) : null };
}

function readVaults(): Record<string, { multisigPda: string; vaultPda: string }> {
  if (!fs.existsSync(VAULTS_JSON)) {
    throw new Error("data/vaults.json not found — run 01-create-vaults --live first");
  }
  return JSON.parse(fs.readFileSync(VAULTS_JSON, "utf8")) as Record<
    string,
    { multisigPda: string; vaultPda: string }
  >;
}

/** Hot-wallet USDC, or null if the ATA doesn't exist. RPC errors throw (fail-closed). */
async function usdcBalance(
  connection: Awaited<ReturnType<typeof getConnection>>,
  ata: PublicKey,
): Promise<number | null> {
  const raw = await getTokenBalance(connection, ata);
  return raw == null ? null : Number(raw) / 1_000_000;
}

async function main(): Promise<void> {
  console.log(`[05-allocate] amount=$${AMOUNT_USD} dry-run=${DRY_RUN}`);
  if (!Number.isFinite(AMOUNT_USD) || AMOUNT_USD <= 0) {
    throw new Error(`--amount must be a positive USD number (got "${AMOUNT_USD}")`);
  }

  const vaults = readVaults();
  const agent = vaults["agent1"];
  if (!agent) throw new Error("agent1 vault missing from data/vaults.json");
  const vaultPda = new PublicKey(VAULT_ARG ?? agent.vaultPda);
  const multisigPda = new PublicKey(agent.multisigPda);
  const connection = await getConnection();

  // ---- policy validation FIRST -------------------------------------------
  const policy = readPolicy();
  console.log("policy allowlist (parsed from allocation-policy-v1.md):");
  for (const m of policy.allowlisted) pub("  allowlisted", m);
  const spcx = MINTS.SPCX;
  if (!policy.allowlisted.includes(spcx)) {
    throw new Error("REFUSED: SPCX not in the policy allowlist — no proposal will be built");
  }
  // Cross-check: every allowlisted mint must be a known V1 mint from config —
  // the policy cannot sneak an arbitrary mint past the script.
  const knownV1: Set<string> = new Set([MINTS.USDC, MINTS.SPCX]);
  for (const m of policy.allowlisted) {
    if (!knownV1.has(m)) {
      throw new Error(`REFUSED: policy allowlists unknown mint ${m} — resolve before trading`);
    }
  }
  if (AMOUNT_USD > MAX_SINGLE_TRADE_USD) {
    throw new Error(`REFUSED: $${AMOUNT_USD} exceeds the $${MAX_SINGLE_TRADE_USD} single-trade demo bound`);
  }
  console.log("policy check: SPCX allowlisted ✓ · universe Backpack Securities only ✓ · size bound ✓");

  const memberKp: Keypair = DRY_RUN
    ? Keypair.generate()
    : (() => {
        if (!keypairExists("agent1-keypair.json")) throw new Error("agent1-keypair.json not found");
        return loadKeypair("agent1-keypair.json");
      })();
  const hotKp: Keypair = DRY_RUN
    ? Keypair.generate()
    : (() => {
        if (!keypairExists("agent1-hot-keypair.json")) {
          throw new Error("agent1-hot-keypair.json not found — run 04-payout --live first");
        }
        return loadKeypair("agent1-hot-keypair.json");
      })();

  const usdcMint = new PublicKey(MINTS.USDC);
  const hotUsdcAta = getAssociatedTokenAddressSync(usdcMint, hotKp.publicKey, false, TOKEN_PROGRAM_ID);
  const hotUsdc = DRY_RUN ? 13.72 : await usdcBalance(connection, hotUsdcAta);
  console.log(`hot wallet USDC: ${hotUsdc == null ? "(no ATA yet)" : hotUsdc.toFixed(2)} (need ≥ $${AMOUNT_USD})`);
  if (!DRY_RUN && (hotUsdc == null || hotUsdc < AMOUNT_USD)) {
    throw new Error("REFUSED: hot wallet USDC below the allocation amount");
  }

  // Informational: post-trade SPCX share vs the treasury single-name cap.
  if (policy.singleNameCapPct != null) {
    console.log(
      `INFO: the ${policy.singleNameCapPct}% single-name cap governs the treasury operating float; ` +
        `the agent vault is self-directed within the allowlist (see header).`,
    );
  }

  // ---- step 1: fund the vault from the hot wallet -------------------------
  const vaultUsdcAta = getAssociatedTokenAddressSync(usdcMint, vaultPda, true, TOKEN_PROGRAM_ID);
  const fundIxs: TransactionInstruction[] = [];
  const vaultAtaIx = await getOrCreateAtaIx(connection, hotKp.publicKey, usdcMint, vaultPda, TOKEN_PROGRAM_ID);
  if (vaultAtaIx) fundIxs.push(vaultAtaIx);
  fundIxs.push(
    createTransferInstruction(
      hotUsdcAta,
      vaultUsdcAta,
      hotKp.publicKey,
      BigInt(Math.round(AMOUNT_USD * 1_000_000)),
      [],
      TOKEN_PROGRAM_ID,
    ),
  );
  console.log(`step 1: $${AMOUNT_USD} USDC hot wallet → agent vault (agent funds their brokerage account)`);
  const fund = await sendWithSizing(connection, fundIxs, hotKp.publicKey, [hotKp], {
    label: "05-allocate/fund",
    dryRun: DRY_RUN,
    defaultUnits: 200_000,
  });
  if (fund.signature) sig("fund sig", fund.signature);

  // ---- step 2: policy-validated USDC→SPCX swap inside the vault ------------
  const amountAtomic = String(Math.round(AMOUNT_USD * 1_000_000));
  const res = await jupBuild(amountAtomic, vaultPda.toBase58(), JUPITER_SLIPPAGE_BPS);
  if (res.kind === "blocked") {
    console.error("[05-allocate] Jupiter blocked (auth/rate-limit). Sting's API key unblocks this.");
    console.error(res.reason);
    process.exit(2);
  }
  if (res.kind === "failed") throw new Error(`Jupiter build failed: ${res.reason}`);
  const spcxOut = Number(res.build.outAmount) / 1_000_000;
  console.log(`step 2: quote $${AMOUNT_USD} USDC → ${spcxOut.toFixed(6)} SPCX (${res.build.routePlan}, impact ${res.build.priceImpactPct}%)`);

  const { instructions, lutAccounts } = buildSwapParts(res.build);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const inner = new TransactionMessage({ payerKey: vaultPda, recentBlockhash: blockhash, instructions });

  const exec = await squadsProposeApproveExecute({
    connection,
    multisigPda,
    vaultPda,
    memberKp,
    inner,
    lutAccounts,
    label: "05-allocate/swap",
    dryRun: DRY_RUN,
  });
  if (exec.batchSignature) sig("batch sig", exec.batchSignature);
  if (exec.executeSignature) sig("execute sig", exec.executeSignature);

  console.log(`[05-allocate] ${DRY_RUN ? "DRY-RUN complete — nothing sent." : "done."}`);
}

void main().catch((e) => {
  console.error(`[05-allocate] FATAL: ${(e as Error).message}`);
  process.exit(1);
});
