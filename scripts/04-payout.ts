/**
 * 04-payout.ts — executes 70/30 + employer match + protocol fee (build spec §4).
 *
 *  Parameterized by bounty id:
 *    bounty-001 ($20): $0.40 fee (2%, retained in treasury — no transfer) ·
 *      $13.72 USDC → agent hot wallet · $5.88 SPCX → agent-1 vault (vesting row) ·
 *      $0.588 SPCX match (10% of vested slice, SEPARATE transfer + ledger row)
 *    bounty-002 ($10): $0.20 · $6.86 · $2.94 · $0.294
 *  Amounts are COMPUTED from the bounty USD (fee 2%, net 70/30, match 10% of
 *  the vested slice) — the config REFERENCE_PAYOUTS are sanity anchors, not inputs.
 *
 *  The USD-denominated vested slice converts to SPCX at the LIVE Jupiter
 *  quote at payout time (a $X USDC→SPCX quote sizes the transfer; no swap
 *  executes — the SPCX comes from the treasury's 02b inventory). If inventory
 *  is short, the script aborts instead of short-paying.
 *
 *  All three money legs run as Squads vault transactions from the treasury
 *  vault (the employer's payroll account): USDC→hot wallet, SPCX principal→
 *  agent vault, SPCX match→agent vault. The agent hot wallet is a fresh
 *  script-held keypair (disclosed; prod: the agent holds its own hot key).
 *
 *  Appends the vesting-ledger row per data/SCHEMAS.md (principal/match in
 *  SPCX token units; USD values kept alongside) and upserts data/agents.json.
 *  Prints + records every signature.
 *
 *  SAFETY: dry-run is the default. The real run needs --live AND --i-confirm
 *  (the explicit flag representing Sting's async verifier sign-off).
 *  --dry-run (default): quotes the live SPCX conversion, builds and prints
 *    every transfer + the ledger row, writes nothing, sends nothing.
 */

import fs from "node:fs";
import path from "node:path";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  BOUNTY_USD,
  EMPLOYER_MATCH_BPS,
  MINTS,
  PROTOCOL_FEE_BPS,
  VESTING_CLIFF_DAYS,
  VESTING_DURATION_DAYS,
  WORKER_USDC_BPS,
  WORKER_VESTED_BPS,
} from "../lib/config.js";
import { jupBuild } from "../lib/jupiter.js";
import {
  TOKEN_2022,
  ataFor,
  getConnection,
  getOrCreateAtaIx,
  getTokenBalance,
  keypairExists,
  loadKeypair,
  loadOrGenerateKeypair,
  squadsProposeApproveExecute,
} from "../lib/squads.js";
import { pub, sig } from "../lib/safe-log.js";

const DRY_RUN = !process.argv.includes("--live");
const CONFIRMED = process.argv.includes("--i-confirm");
const BOUNTY_ID = process.argv.find((a) => a.startsWith("--bounty-id="))?.split("=")[1];

const REPO_ROOT = path.join(import.meta.dirname ?? ".", "..");
const VAULTS_JSON = path.join(REPO_ROOT, "data", "vaults.json");
const LEDGER_JSON = path.join(REPO_ROOT, "data", "vesting-ledger.json");
const AGENTS_JSON = path.join(REPO_ROOT, "data", "agents.json");
const BOUNTIES_JSON = path.join(REPO_ROOT, "data", "bounties.json");

const BOUNTY_USD_MAP: Record<string, number> = {
  "bounty-001": BOUNTY_USD.ONE,
  "bounty-002": BOUNTY_USD.TWO,
};

function readVaults(): { multisigPda: string; vaultPda: string } {
  if (!fs.existsSync(VAULTS_JSON)) {
    throw new Error("data/vaults.json not found — run 01-create-vaults --live first");
  }
  const all = JSON.parse(fs.readFileSync(VAULTS_JSON, "utf8")) as Record<
    string,
    { multisigPda: string; vaultPda: string }
  >;
  const [t, a1] = [all["treasury"], all["agent1"]];
  if (!t || !a1) throw new Error("treasury/agent1 vaults missing from data/vaults.json");
  return { multisigPda: t.multisigPda, vaultPda: t.vaultPda };
}

function agentVault(): string {
  const all = JSON.parse(fs.readFileSync(VAULTS_JSON, "utf8")) as Record<string, { vaultPda: string }>;
  return all["agent1"]!.vaultPda;
}

function fmtSpcx(atomic: bigint): string {
  return (Number(atomic) / 1_000_000).toFixed(6);
}

async function main(): Promise<void> {
  console.log(`[04-payout] bounty=${BOUNTY_ID ?? "(missing)"} dry-run=${DRY_RUN} i-confirm=${CONFIRMED}`);
  if (!BOUNTY_ID || !(BOUNTY_ID in BOUNTY_USD_MAP)) {
    throw new Error(`--bounty-id=bounty-001|bounty-002 is required (got "${BOUNTY_ID ?? ""}")`);
  }
  if (!DRY_RUN && !CONFIRMED) {
    throw new Error("refusing: the real payout requires --i-confirm (Sting's verifier sign-off)");
  }

  const bountyUsd = BOUNTY_USD_MAP[BOUNTY_ID]!;
  const feeUsd = (bountyUsd * PROTOCOL_FEE_BPS) / 10_000;
  const netUsd = bountyUsd - feeUsd;
  const usdcOut = (netUsd * WORKER_USDC_BPS) / 10_000;
  const vestedUsd = (netUsd * WORKER_VESTED_BPS) / 10_000;
  const matchUsd = (vestedUsd * EMPLOYER_MATCH_BPS) / 10_000;

  console.log(`bounty $${bountyUsd}: fee $${feeUsd.toFixed(2)} (retained in treasury — no transfer)`);
  console.log(`  liquid: $${usdcOut.toFixed(2)} USDC → agent hot wallet`);
  console.log(`  vested: $${vestedUsd.toFixed(2)} → SPCX (live quote) → agent vault`);
  console.log(`  match:  $${matchUsd.toFixed(3)} → SPCX (live quote) → agent vault (separate transfer)`);

  const { multisigPda: ms, vaultPda: vp } = readVaults();
  const multisigPda = new PublicKey(ms);
  const treasuryVault = new PublicKey(vp);
  const agentVaultPda = new PublicKey(agentVault());
  const connection = await getConnection();

  const memberKp: Keypair = DRY_RUN
    ? Keypair.generate()
    : (() => {
        if (!keypairExists("squads-member-keypair.json")) {
          throw new Error("squads-member-keypair.json not found — run 01-create-vaults --live first");
        }
        return loadKeypair("squads-member-keypair.json");
      })();

  // Live SPCX conversion for the vested slice + match (quote sizes the
  // transfer; the SPCX itself comes from the 02b inventory — no swap here).
  async function quoteSpcx(usd: number, what: string): Promise<bigint> {
    const atomic = String(Math.round(usd * 1_000_000));
    const res = await jupBuild(atomic, treasuryVault.toBase58());
    if (res.kind !== "ok") {
      throw new Error(`live SPCX quote failed for ${what} ($${usd}): ${res.reason}`);
    }
    const out = BigInt(res.build.outAmount);
    console.log(`  live quote ${what}: $${usd} → ${fmtSpcx(out)} SPCX (${res.build.routePlan})`);
    return out;
  }
  const spcxPrincipal = await quoteSpcx(Number(vestedUsd.toFixed(2)), "vested slice");
  const spcxMatch = await quoteSpcx(Number(matchUsd.toFixed(3)), "match");

  // Inventory check: treasury vault must hold principal + match.
  const spcxMint = new PublicKey(MINTS.SPCX);
  const SPCX_DECIMALS = 6; // verified onchain 2026-09-23 (token balance read)
  const treasurySpcxAta = ataFor(spcxMint, treasuryVault, TOKEN_2022);
  // A failed read aborts via getTokenBalance — inventory must never silently read 0.
  const inventory = (await getTokenBalance(connection, treasurySpcxAta)) ?? 0n;
  const need = spcxPrincipal + spcxMatch;
  console.log(`treasury SPCX inventory: ${fmtSpcx(inventory)} (need ${fmtSpcx(need)})`);
  if (!DRY_RUN && inventory < need) {
    throw new Error("treasury SPCX inventory short — re-run 02b-acquire-spcx --live (or top up) before paying out");
  }

  // Agent hot wallet (script-held keypair, disclosed; prod: agent-held).
  // PERSISTED — it receives the agent's USDC; losing it strands funds
  // (2026-09-23 lesson: never save=false on a key that receives value).
  const hot = DRY_RUN
    ? { kp: Keypair.generate(), generated: true }
    : loadOrGenerateKeypair("agent1-hot-keypair.json");
  pub("agent hot wallet", hot.kp.publicKey.toBase58());

  const usdcMint = new PublicKey(MINTS.USDC);
  const treasuryUsdcAta = getAssociatedTokenAddressSync(usdcMint, treasuryVault, true, TOKEN_PROGRAM_ID);
  const hotUsdcAta = getAssociatedTokenAddressSync(usdcMint, hot.kp.publicKey, false, TOKEN_PROGRAM_ID);
  const agentSpcxAta = ataFor(spcxMint, agentVaultPda, TOKEN_2022);

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const innerOf = (ixs: TransactionInstruction[]) =>
    new TransactionMessage({ payerKey: treasuryVault, recentBlockhash: blockhash, instructions: ixs });

  // Leg 1: USDC → hot wallet (create hot ATA inside the vault tx if missing),
  // plus a 0.002 SOL fee float so the script-held hot wallet can later fund
  // the agent vault (05-allocate step 1) — disclosed, not a secret top-up.
  const leg1: TransactionInstruction[] = [];
  const hotAtaIx = await getOrCreateAtaIx(connection, treasuryVault, usdcMint, hot.kp.publicKey, TOKEN_PROGRAM_ID);
  if (hotAtaIx) leg1.push(hotAtaIx);
  leg1.push(
    SystemProgram.transfer({
      fromPubkey: treasuryVault,
      toPubkey: hot.kp.publicKey,
      lamports: Math.round(0.002 * LAMPORTS_PER_SOL),
    }),
  );
  leg1.push(
    createTransferInstruction(
      treasuryUsdcAta,
      hotUsdcAta,
      treasuryVault,
      BigInt(Math.round(usdcOut * 1_000_000)),
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  // Leg 2: SPCX principal → agent vault.
  // SPCX is Token-2022 and REQUIRES transfer_checked (plain transfer fails
  // with "use transfer_checked or transfer_checked_with_fee", 2026-09-23).
  const leg2: TransactionInstruction[] = [];
  const a1SpcxIx = await getOrCreateAtaIx(connection, treasuryVault, spcxMint, agentVaultPda, TOKEN_2022);
  if (a1SpcxIx) leg2.push(a1SpcxIx);
  leg2.push(
    createTransferCheckedInstruction(
      treasurySpcxAta, spcxMint, agentSpcxAta, treasuryVault, spcxPrincipal, SPCX_DECIMALS, [], TOKEN_2022,
    ),
  );

  // Leg 3: SPCX match → agent vault (separate transfer so the ledger shows it).
  const leg3: TransactionInstruction[] = [
    createTransferCheckedInstruction(
      treasurySpcxAta, spcxMint, agentSpcxAta, treasuryVault, spcxMatch, SPCX_DECIMALS, [], TOKEN_2022,
    ),
  ];

  const legs: [string, TransactionInstruction[]][] = [
    [`04-payout/${BOUNTY_ID}/usdc`, leg1],
    [`04-payout/${BOUNTY_ID}/vest`, leg2],
    [`04-payout/${BOUNTY_ID}/match`, leg3],
  ];
  // Resume support (2026-09-23): if a previous run completed some legs and
  // died, re-run with --from-leg=vest|match to skip the legs that already
  // executed. Never re-sends a completed leg — double-pay protection.
  const FROM_LEG = process.argv.find((a) => a.startsWith("--from-leg="))?.split("=")[1];
  const startIdx = FROM_LEG ? legs.findIndex(([l]) => l.endsWith(`/${FROM_LEG}`)) : 0;
  if (FROM_LEG && startIdx < 0) throw new Error(`--from-leg=${FROM_LEG} not a leg (usdc|vest|match)`);
  const sigs: Record<string, string | null> = {};
  for (const [label, ixs] of legs.slice(startIdx)) {
    const r = await squadsProposeApproveExecute({
      connection,
      multisigPda,
      vaultPda: treasuryVault,
      memberKp,
      inner: innerOf(ixs),
      lutAccounts: [],
      label,
      dryRun: DRY_RUN,
    });
    sigs[label] = r.executeSignature;
    if (r.executeSignature) sig(`${label} execute sig`, r.executeSignature);
  }

  // Vesting-ledger row (amounts in SPCX token units; USD kept alongside).
  const nowTs = Math.floor(Date.now() / 1000);
  const row = {
    id: `vest-${BOUNTY_ID}`,
    agent: "agent-1",
    vault: agentVaultPda.toBase58(),
    mint: MINTS.SPCX,
    principalAmount: fmtSpcx(spcxPrincipal),
    principalUsd: Number(vestedUsd.toFixed(2)),
    matchAmount: fmtSpcx(spcxMatch),
    matchUsd: Number(matchUsd.toFixed(3)),
    matchRateBps: EMPLOYER_MATCH_BPS,
    feeBps: PROTOCOL_FEE_BPS,
    startTs: DRY_RUN ? 0 : nowTs,
    cliffDays: VESTING_CLIFF_DAYS,
    durationDays: VESTING_DURATION_DAYS,
    status: "active",
    fundingTx: sigs[`04-payout/${BOUNTY_ID}/vest`] ?? null,
    matchTx: sigs[`04-payout/${BOUNTY_ID}/match`] ?? null,
    enforcement: "ledger-manual — disclosed, not a program",
  };
  console.log("\nvesting-ledger row:");
  console.log(JSON.stringify(row, null, 2));

  if (DRY_RUN) {
    console.log("\n[04-payout] DRY-RUN complete — nothing written, nothing sent.");
    console.log("On --live --i-confirm this appends the ledger row and upserts data/agents.json.");
    return;
  }

  const ledger = JSON.parse(fs.readFileSync(LEDGER_JSON, "utf8")) as { schedules: unknown[] };
  if (ledger.schedules.some((s) => (s as { id?: string }).id === row.id)) {
    throw new Error(`ledger already has ${row.id} — refusing double-pay`);
  }
  ledger.schedules.push(row);
  fs.writeFileSync(LEDGER_JSON, JSON.stringify(ledger, null, 2) + "\n");
  console.log(`appended ${row.id} to data/vesting-ledger.json`);

  const agents = JSON.parse(fs.readFileSync(AGENTS_JSON, "utf8")) as {
    agents: { id: string; hotWallet?: string }[];
  };
  const a1 = agents.agents.find((a) => a.id === "agent-1");
  if (a1) {
    a1.hotWallet = hot.kp.publicKey.toBase58();
    fs.writeFileSync(AGENTS_JSON, JSON.stringify(agents, null, 2) + "\n");
    console.log("upserted agent-1 hotWallet in data/agents.json");
  }
  // Mark the bounty row paid (public board state).
  const bountiesDoc = JSON.parse(fs.readFileSync(BOUNTIES_JSON, "utf8")) as {
    bounties: { id: string; status: string; payoutTx: string | null }[];
  };
  const brow = bountiesDoc.bounties.find((b) => b.id === BOUNTY_ID);
  if (brow) {
    brow.status = "paid";
    brow.payoutTx = sigs[`04-payout/${BOUNTY_ID}/usdc`] ?? null;
    fs.writeFileSync(BOUNTIES_JSON, JSON.stringify(bountiesDoc, null, 2) + "\n");
    console.log(`marked ${BOUNTY_ID} paid in data/bounties.json`);
  }
  console.log("[04-payout] done.");
}

void main().catch((e) => {
  console.error(`[04-payout] FATAL: ${(e as Error).message}`);
  process.exit(1);
});
