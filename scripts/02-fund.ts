/**
 * 02-fund.ts — funds vaults from the treasury keypair (build spec §4).
 *
 *  Treasury keypair → vault PDAs: USDC + SOL operating float (treasury vault).
 *  Creates ATAs with the Token-2022 program id where needed (payer = script
 *  keypair). Pre-creates the SPCX ATAs for all three vaults so 02b/04 never
 *  fight ATA creation inside Squads proposals. No ALLINU position in V1 —
 *  the drip is the demonstrated future funding rail, not V1's funding.
 *
 *  Funding plan (constants below, operator-tunable):
 *    treasury vault: 0.06 SOL (proposal/execution fees) + 75 USDC (operating
 *                    float: covers the $12 SPCX acquisition + $20.58 payouts)
 *    agent1 vault:   0.005 SOL (dust-test + future proposal fees)
 *    agent2 vault:   0.005 SOL
 *  Everything else stays in the project wallet as visible runway.
 *
 *  Reads data/vaults.json (written by 01-create-vaults). Refuses the real
 *  run if balances don't cover the plan plus a 0.01 SOL safety margin.
 *
 *  SAFETY: dry-run is the default. The real run needs --live.
 *  --dry-run (default): reads current balances, prints every transfer/ATA
 *    payload and the resulting runway, sends nothing.
 */

import fs from "node:fs";
import path from "node:path";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { MINTS, TREASURY_WALLET } from "../lib/config.js";
import {
  TOKEN_2022,
  ataFor,
  getConnection,
  getOrCreateAtaIx,
  getTokenBalance,
  keypairExists,
  loadKeypair,
  sendWithSizing,
} from "../lib/squads.js";
import { pub } from "../lib/safe-log.js";

const DRY_RUN = !process.argv.includes("--live");

const REPO_ROOT = path.join(import.meta.dirname ?? ".", "..");
const VAULTS_JSON = path.join(REPO_ROOT, "data", "vaults.json");

// Operator-tunable funding plan.
const PLAN = {
  treasury: { sol: 0.06, usdc: 75 },
  agent1: { sol: 0.005, usdc: 0 },
  agent2: { sol: 0.005, usdc: 0 },
} as const;
const SAFETY_MARGIN_SOL = 0.01;

interface VaultAddrs {
  multisigPda: string;
  vaultPda: string;
  createKey: string;
}

function readVaults(): Record<string, VaultAddrs> {
  if (!fs.existsSync(VAULTS_JSON)) {
    throw new Error(`data/vaults.json not found — run 01-create-vaults --live first`);
  }
  return JSON.parse(fs.readFileSync(VAULTS_JSON, "utf8")) as Record<string, VaultAddrs>;
}

async function main(): Promise<void> {
  console.log(`[02-fund] dry-run=${DRY_RUN}`);
  const vaults = readVaults();
  const connection = await getConnection();

  // Dry-run plans against the REAL public project-wallet address (balance
  // reads + fromPubkey are accurate); the signer shown is illustrative and no
  // secret is loaded. The real run loads the treasury keypair from KEYS_DIR.
  const treasuryKp: Keypair | null = DRY_RUN
    ? null
    : (() => {
        if (!keypairExists("treasury-keypair.json")) {
          throw new Error("treasury-keypair.json not found in KEYS_DIR");
        }
        return loadKeypair("treasury-keypair.json");
      })();
  const payer: PublicKey = DRY_RUN ? new PublicKey(TREASURY_WALLET) : treasuryKp!.publicKey;
  const signers: Keypair[] = DRY_RUN ? [Keypair.generate()] : [treasuryKp!];
  if (DRY_RUN) {
    console.log("note: dry-run plans against the real project-wallet address; signer shown is illustrative");
  }

  const usdcMint = new PublicKey(MINTS.USDC);
  const spcxMint = new PublicKey(MINTS.SPCX);
  const payerUsdcAta = getAssociatedTokenAddressSync(usdcMint, payer, false, TOKEN_PROGRAM_ID);

  // Current balances (read even on dry-run — needed for the runway math).
  // A failed read aborts: it must never silently become 0.
  const payerSol = (await connection.getBalance(payer, "confirmed")) / LAMPORTS_PER_SOL;
  const payerUsdcRaw = await getTokenBalance(connection, payerUsdcAta);
  const payerUsdc = Number(payerUsdcRaw ?? 0n) / 1_000_000;
  pub("project wallet", payer.toBase58());
  console.log(`  current: ${payerSol.toFixed(4)} SOL, ${payerUsdc.toFixed(2)} USDC`);

  const needSol =
    PLAN.treasury.sol + PLAN.agent1.sol + PLAN.agent2.sol + SAFETY_MARGIN_SOL;
  const needUsdc = PLAN.treasury.usdc + PLAN.agent1.usdc + PLAN.agent2.usdc;
  console.log(`  plan needs: ${needSol.toFixed(4)} SOL (incl. ${SAFETY_MARGIN_SOL} margin), ${needUsdc} USDC`);
  if (!DRY_RUN && (payerSol < needSol || payerUsdc < needUsdc)) {
    throw new Error("insufficient project-wallet balance for the funding plan — aborting");
  }
  console.log(
    `  runway after plan: ${(payerSol - needSol + SAFETY_MARGIN_SOL).toFixed(4)} SOL, ${(payerUsdc - needUsdc).toFixed(2)} USDC (stays visible in the project wallet)`,
  );

  const tVault = new PublicKey(vaults["treasury"]!.vaultPda);
  const a1Vault = new PublicKey(vaults["agent1"]!.vaultPda);
  const a2Vault = new PublicKey(vaults["agent2"]!.vaultPda);

  // --- tx A: SOL transfers -------------------------------------------------
  const solIxs: TransactionInstruction[] = [];
  const solLegs: [string, PublicKey, number][] = [
    ["treasury", tVault, PLAN.treasury.sol],
    ["agent1", a1Vault, PLAN.agent1.sol],
    ["agent2", a2Vault, PLAN.agent2.sol],
  ];
  for (const [name, dest, sol] of solLegs) {
    if (sol <= 0) continue;
    solIxs.push(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: dest,
        lamports: Math.round(sol * LAMPORTS_PER_SOL),
      }),
    );
    console.log(`  SOL leg: ${sol} SOL → ${name} vault`);
    pub(`    vaultPda`, dest.toBase58());
  }
  if (solIxs.length > 0) {
    await sendWithSizing(connection, solIxs, payer, signers, {
      label: "02-fund/sol",
      dryRun: DRY_RUN,
      defaultUnits: 100_000,
    });
  }

  // --- tx B: ATA creation + USDC transfers --------------------------------
  const ataIxs: TransactionInstruction[] = [];
  // Treasury USDC ATA (classic) + SPCX ATA (Token-2022); agent SPCX ATAs (Token-2022).
  const ataJobs: [string, PublicKey, PublicKey, PublicKey][] = [
    ["treasury/USDC", usdcMint, tVault, TOKEN_PROGRAM_ID],
    ["treasury/SPCX", spcxMint, tVault, TOKEN_2022],
    ["agent1/SPCX", spcxMint, a1Vault, TOKEN_2022],
    ["agent2/SPCX", spcxMint, a2Vault, TOKEN_2022],
  ];
  for (const [label, mint, owner, programId] of ataJobs) {
    const ix = await getOrCreateAtaIx(connection, payer, mint, owner, programId);
    const ata = ataFor(mint, owner, programId);
    if (ix) {
      ataIxs.push(ix);
      console.log(`  create ATA: ${label}`);
    } else {
      console.log(`  ATA exists: ${label}`);
    }
    pub(`    ata`, ata.toBase58());
  }

  if (PLAN.treasury.usdc > 0) {
    const dest = ataFor(usdcMint, tVault, TOKEN_PROGRAM_ID);
    ataIxs.push(
      createTransferInstruction(
        payerUsdcAta,
        dest,
        payer,
        BigInt(Math.round(PLAN.treasury.usdc * 1_000_000)),
        [],
        TOKEN_PROGRAM_ID,
      ),
    );
    console.log(`  USDC leg: ${PLAN.treasury.usdc} USDC → treasury vault`);
  }

  if (ataIxs.length > 0) {
    const r = await sendWithSizing(connection, ataIxs, payer, signers, {
      label: "02-fund/atas+usdc",
      dryRun: DRY_RUN,
      defaultUnits: 300_000,
    });
    if (r.signature) pub("02-fund atas+usdc sig", r.signature);
  }

  console.log(`[02-fund] ${DRY_RUN ? "DRY-RUN complete — nothing sent." : "done."}`);
}

void main().catch((e) => {
  console.error(`[02-fund] FATAL: ${(e as Error).message}`);
  process.exit(1);
});
