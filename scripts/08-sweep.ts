/**
 * 08-sweep.ts — return all agent-vault tokens to the treasury vault.
 *
 *  Pre-overhaul reset (2026-09-23 walkthrough, F3 decision): the activity
 *  wire starts fresh at the full test, so every token in the agent accounts
 *  goes home first. For each agent vault (agent1, agent2 — read from
 *  data/vaults.json, NOT hardcoded):
 *    - full SPCX balance (Token-2022, transfer_checked, 6 decimals) → treasury
 *    - full USDC balance (Token, transfer) → treasury
 *    - SOL is UNTOUCHED — stays in the vault as the fee/rent buffer so the
 *      vault remains usable for the full test. (Agent vaults hold ~0.005 SOL
 *      each; sweeping them to zero would brick future signatures.)
 *
 *  Each non-empty token move runs as one Squads vault transaction from the
 *  agent's own multisig (threshold 1, script-held member key — the key that
 *  stands in for the agent's own key, per 01-create-vaults).
 *
 *  SAFETY: dry-run is the default. The real run needs --live AND --i-confirm
 *  (the explicit flag representing Sting's sign-off — no unilateral moves).
 *  Balances are read LIVE onchain at run time; the script refuses to size a
 *  transfer from anything else. RPC errors throw — a failed read never
 *  becomes a zero.
 */

import fs from "node:fs";
import path from "node:path";
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import { MINTS } from "../lib/config.js";
import {
  TOKEN_2022,
  ataFor,
  getConnection,
  getTokenBalance,
  keypairExists,
  loadKeypair,
  squadsProposeApproveExecute,
} from "../lib/squads.js";
import { pub, sig } from "../lib/safe-log.js";

const DRY_RUN = !process.argv.includes("--live");
const CONFIRMED = process.argv.includes("--i-confirm");

const REPO_ROOT = path.join(import.meta.dirname ?? ".", "..");
const VAULTS_JSON = path.join(REPO_ROOT, "data", "vaults.json");

const SPCX_DECIMALS = 6; // verified onchain 2026-09-23 (token balance read)
const USDC_DECIMALS = 6;

interface VaultEntry {
  multisigPda: string;
  vaultPda: string;
}

function readVaults(): Record<string, VaultEntry> {
  const raw = fs.readFileSync(VAULTS_JSON, "utf8");
  const data = JSON.parse(raw) as Record<string, VaultEntry>;
  if (!data.treasury?.vaultPda) throw new Error("vaults.json missing treasury");
  return data;
}

const fmtTok = (atomic: bigint, decimals = 6): string =>
  (Number(atomic) / 10 ** decimals).toFixed(decimals);

async function main(): Promise<void> {
  if (!DRY_RUN && !CONFIRMED) {
    throw new Error("refusing live run without --i-confirm (Sting's sign-off)");
  }
  console.log(`08-sweep — ${DRY_RUN ? "DRY-RUN (nothing will be sent)" : "LIVE RUN"}`);

  const vaults = readVaults();
  const treasuryVault = new PublicKey(vaults.treasury.vaultPda);
  const treasuryMs = new PublicKey(vaults.treasury.multisigPda);
  pub("treasury vault", treasuryVault.toBase58());
  void treasuryMs;

  const spcxMint = new PublicKey(MINTS.SPCX);
  const usdcMint = new PublicKey(MINTS.USDC);
  const treasurySpcxAta = ataFor(spcxMint, treasuryVault, TOKEN_2022);
  const treasuryUsdcAta = ataFor(usdcMint, treasuryVault, TOKEN_PROGRAM_ID);

  const connection = await getConnection();

  // Treasury ATAs must already exist — the sweep must never make an agent
  // vault pay rent for the treasury's accounts.
  for (const [name, ata] of [["treasury SPCX ATA", treasurySpcxAta], ["treasury USDC ATA", treasuryUsdcAta]] as const) {
    const info = await connection.getAccountInfo(ata, "confirmed");
    if (!info) throw new Error(`${name} ${ata.toBase58()} does not exist — aborting (would force agent-funded rent)`);
    console.log(`  ${name} exists: ${ata.toBase58()}`);
  }

  const agentNames = Object.keys(vaults).filter((k) => {
    const e: unknown = (vaults as Record<string, unknown>)[k];
    return (
      k !== "treasury" &&
      typeof e === "object" &&
      e !== null &&
      typeof (e as VaultEntry).vaultPda === "string" &&
      typeof (e as VaultEntry).multisigPda === "string"
    );
  });
  console.log(`agent vaults: ${agentNames.join(", ") || "(none)"}`);

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const sigs: Record<string, string | null> = {};

  for (const name of agentNames) {
    const entry = vaults[name]!;
    const multisigPda = new PublicKey(entry.multisigPda);
    const agentVault = new PublicKey(entry.vaultPda);
    console.log(`\n── ${name} — vault ${agentVault.toBase58()} (multisig ${multisigPda.toBase58()})`);

    const memberKp: Keypair = DRY_RUN
      ? Keypair.generate()
      : (() => {
          const keyName = `${name}-keypair.json`;
          if (!keypairExists(keyName)) throw new Error(`${keyName} not found — cannot sign for ${name}`);
          return loadKeypair(keyName);
        })();

    // Live onchain reads. Null = ATA absent = zero balance, nothing to move.
    const agentSpcxAta = ataFor(spcxMint, agentVault, TOKEN_2022);
    const agentUsdcAta = ataFor(usdcMint, agentVault, TOKEN_PROGRAM_ID);
    const spcxBal = await getTokenBalance(connection, agentSpcxAta);
    const usdcBal = await getTokenBalance(connection, agentUsdcAta);
    const solBal = await connection.getBalance(agentVault, "confirmed");
    console.log(`  SPCX: ${spcxBal === null ? "(no ATA)" : fmtTok(spcxBal) + " SPCX"}`);
    console.log(`  USDC: ${usdcBal === null ? "(no ATA)" : fmtTok(usdcBal, USDC_DECIMALS) + " USDC"}`);
    console.log(`  SOL:  ${(solBal / 1e9).toFixed(6)} SOL (untouched — fee/rent buffer)`);

    const ixs: TransactionInstruction[] = [];
    if (spcxBal !== null && spcxBal > 0n) {
      ixs.push(
        createTransferCheckedInstruction(
          agentSpcxAta, spcxMint, treasurySpcxAta, agentVault, spcxBal, SPCX_DECIMALS, [], TOKEN_2022,
        ),
      );
      console.log(`  → sweep ${fmtTok(spcxBal)} SPCX → treasury`);
    }
    if (usdcBal !== null && usdcBal > 0n) {
      ixs.push(
        createTransferInstruction(agentUsdcAta, treasuryUsdcAta, agentVault, usdcBal, [], TOKEN_PROGRAM_ID),
      );
      console.log(`  → sweep ${fmtTok(usdcBal, USDC_DECIMALS)} USDC → treasury`);
    }
    if (ixs.length === 0) {
      console.log(`  nothing to sweep — no vault transaction needed`);
      continue;
    }

    const inner = new TransactionMessage({
      payerKey: agentVault,
      recentBlockhash: blockhash,
      instructions: ixs,
    });
    const r = await squadsProposeApproveExecute({
      connection,
      multisigPda,
      vaultPda: agentVault,
      memberKp,
      inner,
      lutAccounts: [],
      label: `08-sweep/${name}`,
      dryRun: DRY_RUN,
    });
    sigs[`08-sweep/${name}`] = r.executeSignature;
    if (r.executeSignature) sig(`08-sweep/${name} execute sig`, r.executeSignature);
  }

  console.log("\n08-sweep complete.");
  console.log(JSON.stringify({ dryRun: DRY_RUN, executeSigs: sigs }, null, 2));
}

main().catch((e) => {
  console.error(`08-sweep FAILED: ${(e as Error).message}`);
  process.exit(1);
});
