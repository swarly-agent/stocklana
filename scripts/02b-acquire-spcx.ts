/**
 * 02b-acquire-spcx.ts — treasury swaps ~$12 USDC→SPCX via Jupiter (build spec §4).
 *
 *  Runs after funding, before payouts. This is the protocol's auto-swap of the
 *  vested slice: the worker never touches it. 04-payout pays vested slices
 *  from this inventory.
 *
 *  Flow: GET /swap/v2/build (inputMint=USDC, outputMint=SPCX, amount = exact
 *  atomic USDC, taker = treasury vault PDA, slippageBps from config, platform
 *  fee OMITTED — the 2% protocol fee is taken at bounty payout, never at swap)
 *  → inner TransactionMessage (payer = vault PDA) → Squads propose → approve →
 *  execute via lib/squads.ts (transactionIndex read onchain, never hardcoded;
 *  proposalCreate is a mandatory separate step with isDraft: false; execute
 *  returns unsigned and the script signs as member + feePayer).
 *
 *  Pre-flight: the treasury vault must hold ≥ $12 USDC (02-fund), else abort.
 *
 *  SAFETY: dry-run is the default. The real run needs --live.
 *  --dry-run (default): quotes + simulates the swap, prints the route,
 *    expected SPCX out, and every Squads payload. Sends nothing.
 */

import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey, TransactionMessage } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  JUPITER_SLIPPAGE_BPS,
  MINTS,
  TREASURY_SPCX_ACQUIRE_USD,
} from "../lib/config.js";
import { buildSwapParts, jupBuild } from "../lib/jupiter.js";
import {
  getConnection,
  keypairExists,
  loadKeypair,
  squadsProposeApproveExecute,
} from "../lib/squads.js";
import { pub } from "../lib/safe-log.js";

const DRY_RUN = !process.argv.includes("--live");

const REPO_ROOT = path.join(import.meta.dirname ?? ".", "..");
const VAULTS_JSON = path.join(REPO_ROOT, "data", "vaults.json");

function readVaults(): { multisigPda: string; vaultPda: string } {
  if (!fs.existsSync(VAULTS_JSON)) {
    throw new Error("data/vaults.json not found — run 01-create-vaults --live first");
  }
  const all = JSON.parse(fs.readFileSync(VAULTS_JSON, "utf8")) as Record<
    string,
    { multisigPda: string; vaultPda: string }
  >;
  const t = all["treasury"];
  if (!t) throw new Error("treasury vault missing from data/vaults.json");
  return t;
}

async function main(): Promise<void> {
  console.log(`[02b-acquire-spcx] dry-run=${DRY_RUN}`);
  const { multisigPda: ms, vaultPda: vp } = readVaults();
  const multisigPda = new PublicKey(ms);
  const vaultPda = new PublicKey(vp);
  const connection = await getConnection();

  const memberKp: Keypair = DRY_RUN
    ? Keypair.generate()
    : (() => {
        if (!keypairExists("squads-member-keypair.json")) {
          throw new Error("squads-member-keypair.json not found — run 01-create-vaults --live first");
        }
        return loadKeypair("squads-member-keypair.json");
      })();

  const amountAtomic = String(Math.round(TREASURY_SPCX_ACQUIRE_USD * 1_000_000));
  console.log(`acquiring $${TREASURY_SPCX_ACQUIRE_USD} SPCX for the treasury vault`);
  pub("treasury vaultPda (taker)", vaultPda.toBase58());

  // Pre-flight: vault must hold the USDC.
  const usdcMint = new PublicKey(MINTS.USDC);
  const vaultUsdcAta = getAssociatedTokenAddressSync(usdcMint, vaultPda, true, TOKEN_PROGRAM_ID);
  let vaultUsdc = 0;
  try {
    const b = await connection.getTokenAccountBalance(vaultUsdcAta, "confirmed");
    vaultUsdc = Number(b.value.amount) / 1_000_000;
  } catch {
    vaultUsdc = 0;
  }
  console.log(`treasury vault USDC: ${vaultUsdc.toFixed(2)} (need ≥ ${TREASURY_SPCX_ACQUIRE_USD})`);
  if (!DRY_RUN && vaultUsdc < TREASURY_SPCX_ACQUIRE_USD) {
    throw new Error("treasury vault USDC below acquisition size — run 02-fund --live first");
  }

  const res = await jupBuild(amountAtomic, vaultPda.toBase58(), JUPITER_SLIPPAGE_BPS);
  if (res.kind === "blocked") {
    console.error("[02b-acquire-spcx] Jupiter blocked (auth/rate-limit). Sting's API key unblocks this.");
    console.error(res.reason);
    process.exit(2);
  }
  if (res.kind === "failed") {
    throw new Error(`Jupiter build failed: ${res.reason}`);
  }
  const build = res.build;
  const spcxOut = Number(build.outAmount) / 1_000_000;
  console.log(`quote: $${TREASURY_SPCX_ACQUIRE_USD} USDC → ${spcxOut.toFixed(6)} SPCX`);
  console.log(`  route: ${build.routePlan} · priceImpact: ${build.priceImpactPct}% · via ${build.source}`);

  const { instructions, lutAccounts } = buildSwapParts(build);
  console.log(`  swap parts: ${instructions.length} instruction(s), ${lutAccounts.length} ALT(s)`);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const inner = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: blockhash,
    instructions,
  });

  const exec = await squadsProposeApproveExecute({
    connection,
    multisigPda,
    vaultPda,
    memberKp,
    inner,
    lutAccounts,
    label: "02b-acquire-spcx",
    dryRun: DRY_RUN,
  });

  console.log(`transactionIndex=${exec.transactionIndex}`);
  if (exec.batchSignature) pub("batch (create+propose+approve) sig", exec.batchSignature);
  if (exec.executeSignature) pub("execute sig", exec.executeSignature);
  console.log(
    `[02b-acquire-spcx] ${DRY_RUN ? "DRY-RUN complete — nothing sent." : `done — treasury holds ~${spcxOut.toFixed(6)} SPCX more. 04-payout draws vested slices from this inventory.`}`,
  );
}

void main().catch((e) => {
  console.error(`[02b-acquire-spcx] FATAL: ${(e as Error).message}`);
  process.exit(1);
});
