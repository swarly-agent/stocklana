/**
 * 07-dust-vault-test.ts — CHECK #4: dust vault test on mainnet.
 *
 * This is the last technical gate before Wednesday. It SPENDS REAL MONEY in
 * dust amounts and is the ONLY script allowed to do so tonight.
 *
 * Flow (build spec §4):
 *  1. Create a THROWAWAY test vault: Squads v4 multisigCreateV2, 1 member
 *     (the script key), threshold 1, configAuthority null. This is NOT the
 *     treasury vault — that needs Sting's member pubkey, which we don't have.
 *  2. Swap $0.25 USDC→SPCX via Jupiter into the script-held account
 *     (reuses lib/jupiter.ts: jupBuild + assembleVersionedTx, verified
 *     tonight in check #3).
 *  3. Transfer dust SPCX INTO the test vault (receive).
 *  4. Transfer it back OUT via the full Squads proposal flow:
 *     vaultTransactionCreate (transactionIndex read from the onchain multisig
 *     account — never hardcoded) → proposalCreate (isDraft: false) →
 *     proposalApprove → vaultTransactionExecute (returns unsigned — the
 *     script signs as member + feePayer before sending).
 *
 * Proves: Squads vaults can receive, hold, and send Token-2022 SPCX.
 *
 * BUDGET (hard): DUST ONLY. Abort — do not retry, do not continue — if any
 * single step is projected above $1 or total outflow is projected above $2.
 * SOL/USD is fetched live at startup (CoinGecko, conservative $250 fallback).
 *
 * Secrets: loads the script keypair from out-of-tree KEYS_DIR
 * (~/workspace/stocklana/hidden_files/treasury-keypair.json) ONLY to sign.
 * The public key is verified against TREASURY_WALLET before anything is
 * signed. Prints public keys + signatures only (lib/safe-log.ts).
 *
 * Exit codes: 0 = PASS · 1 = FAIL (vault pattern broken — kill-line) ·
 *             2 = ABORTED (budget/safety/transport stop — not a verdict).
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  KEYS_DIR,
  MINTS,
  MINT_DECIMALS,
  TOKEN_2022_PROGRAM_ID,
  TREASURY_WALLET,
} from "../lib/config.js";
import { assembleVersionedTx, jupBuild, txToBase64 } from "../lib/jupiter.js";
import { rpcCall } from "../lib/rpc.js";
import { pub } from "../lib/safe-log.js";
import { confirmTx, getBalanceLamports, sendSignedTx } from "../lib/send.js";

const RESULTS_PATH = path.join(
  os.homedir(),
  "workspace/stocklana/research/falsifier-results-2026-09-22.md",
);

const SWAP_USDC_MICRO = "250000"; // $0.25 — the dust acquisition
const DUST_TARGET = 1000n; // base SPCX units to cycle through the vault
const VAULT_FUND_LAMPORTS = 1_000_000; // 0.001 SOL — pays the inner execute fee

interface StepRecord {
  label: string;
  sig: string;
  costSol: number;
  note: string;
}

const steps: StepRecord[] = [];
let outflowLamports = 0;
let STEP_CAP_SOL = 0;
let TOTAL_CAP_SOL = 0;
let verdict: "PASS" | "FAIL" | "ABORTED" = "ABORTED";
const notes: string[] = [];

function note(line: string): void {
  notes.push(line);
  console.log(line);
}

function writeReport(): void {
  const stamp = new Date().toISOString();
  const lines: string[] = [
    "",
    "---",
    "",
    `## Check 4: dust vault test on mainnet — ${verdict} (${stamp})`,
    "",
    `Budget: $1/step, $2 total (SOL/USD=${SOL_USD_USED} at run start).`,
    "",
    "### Steps (actual SOL cost = script-key balance delta)",
    "",
  ];
  for (const s of steps) {
    lines.push(
      `- ${s.label}: \`${s.sig}\` — ${s.costSol.toFixed(6)} SOL — ${s.note}`,
    );
  }
  lines.push("");
  lines.push(
    `Total outflow from script key: ${(outflowLamports / 1e9).toFixed(6)} SOL (≈$${((outflowLamports / 1e9) * SOL_USD_USED).toFixed(2)})`,
  );
  lines.push("");
  lines.push("### Notes");
  for (const n of notes) lines.push(`- ${n}`);
  lines.push("");
  fs.appendFileSync(RESULTS_PATH, lines.join("\n") + "\n");
  console.log(`\nreport appended: ${RESULTS_PATH}`);
}

let SOL_USD_USED = 250;

/** Hard stop: record, write the partial report, exit — never retry. */
function abort(reason: string): never {
  verdict = "ABORTED";
  note(`ABORT: ${reason}`);
  writeReport();
  process.exit(2);
}

/** Pattern failure: the vault can't do the job — kill-line verdict. */
function fail(reason: string): never {
  verdict = "FAIL";
  note(`FAIL: ${reason}`);
  writeReport();
  process.exit(1);
}

async function solUsd(): Promise<number> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: ctrl.signal },
    );
    clearTimeout(timer);
    const j = (await res.json()) as { solana?: { usd?: number } };
    if (j?.solana?.usd && j.solana.usd > 0) return j.solana.usd;
  } catch {
    /* fall through to conservative default */
  }
  return 250;
}

async function freshBlockhash(): Promise<string> {
  const res = (await rpcCall("getLatestBlockhash", [
    { commitment: "confirmed" },
  ])) as { value: { blockhash: string } };
  return res.value.blockhash;
}

function loadScriptKey(): Keypair {
  const p = path.join(KEYS_DIR, "treasury-keypair.json");
  const raw = fs.readFileSync(p, "utf8");
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  if (kp.publicKey.toBase58() !== TREASURY_WALLET) {
    throw new Error("loaded keypair does not match TREASURY_WALLET — refusing");
  }
  return kp;
}

/** Sum of a wallet's token balances for a mint (base units). */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Balance read with retries — Helius reads can lag the write node. */
async function tokenBalanceRetry(
  owner: PublicKey,
  mint: string,
  label: string,
): Promise<bigint> {
  let last = 0n;
  for (let i = 0; i < 8; i++) {
    last = await tokenBalance(owner, mint);
    if (last > 0n) return last;
    if (i < 7) await sleep(2500);
  }
  note(`${label}: balance still 0 after 8 reads (~20s) — treating as genuinely zero`);
  return last;
}

async function tokenBalance(owner: PublicKey, mint: string): Promise<bigint> {
  const res = (await rpcCall("getTokenAccountsByOwner", [
    owner.toBase58(),
    { mint },
    { encoding: "jsonParsed" },
  ])) as {
    value: {
      account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } };
    }[];
  };
  let total = 0n;
  for (const a of res.value ?? []) {
    total += BigInt(a.account.data.parsed.info.tokenAmount.amount);
  }
  return total;
}

async function sendTx(
  label: string,
  tx: VersionedTransaction,
  estCostSol: number,
  scriptKey: Keypair,
): Promise<string> {
  if (estCostSol > STEP_CAP_SOL) {
    abort(
      `step "${label}" projected ${estCostSol.toFixed(6)} SOL exceeds the $1/step cap`,
    );
  }
  if (outflowLamports / 1e9 + estCostSol > TOTAL_CAP_SOL) {
    abort(
      `step "${label}" would push total outflow past the $2 cap ` +
        `(outflow=${(outflowLamports / 1e9).toFixed(6)} projected+=${estCostSol.toFixed(6)})`,
    );
  }
  const owner = scriptKey.publicKey.toBase58();
  const before = await getBalanceLamports(owner);
  let sig: string;
  try {
    sig = await sendSignedTx(txToBase64(tx));
  } catch (e) {
    abort(`step "${label}": send failed — ${(e as Error).message}`);
  }
  let slot = -1;
  let status = "?";
  try {
    const conf = await confirmTx(sig);
    slot = conf.slot;
    status = conf.status;
  } catch (e) {
    abort(`step "${label}": sig ${sig} — confirmation failed: ${(e as Error).message}`);
  }
  // Settle delay: the balance-read node can lag the write node.
  await sleep(2000);
  const after = await getBalanceLamports(owner);
  const costSol = (before - after) / 1e9;
  outflowLamports += before - after;
  steps.push({ label, sig, costSol, note: `slot ${slot} (${status})` });
  console.log(
    `[step] ${label}: sig=${sig} cost=${costSol.toFixed(6)} SOL (slot ${slot})`,
  );
  if (outflowLamports / 1e9 > TOTAL_CAP_SOL) {
    abort(
      `total outflow ${(outflowLamports / 1e9).toFixed(6)} SOL exceeded the $2 cap`,
    );
  }
  return sig;
}

async function sendIx(
  label: string,
  ixs: TransactionInstruction[],
  signers: Keypair[],
  estCostSol: number,
  scriptKey: Keypair,
): Promise<string> {
  const msg = new TransactionMessage({
    payerKey: scriptKey.publicKey,
    recentBlockhash: await freshBlockhash(),
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign(signers);
  return sendTx(label, tx, estCostSol, scriptKey);
}

async function main(): Promise<void> {
  SOL_USD_USED = await solUsd();
  STEP_CAP_SOL = 1 / SOL_USD_USED;
  TOTAL_CAP_SOL = 2 / SOL_USD_USED;
  console.log(
    `# Check 4: dust vault test — SOL/USD=${SOL_USD_USED} stepCap=${STEP_CAP_SOL.toFixed(6)} totalCap=${TOTAL_CAP_SOL.toFixed(6)}`,
  );

  const scriptKey = loadScriptKey();
  pub("script key (verified = TREASURY_WALLET)", scriptKey.publicKey.toBase58());

  const conn = new Connection("https://solana-rpc.publicnode.com", "confirmed");
  const MINT = new PublicKey(MINTS.SPCX);
  const T22 = new PublicKey(TOKEN_2022_PROGRAM_ID);

  // ---- preflight: program config (creation fee) + PDAs. No sends yet.
  const [configPda] = multisig.getProgramConfigPda({});
  const cfg = await multisig.accounts.ProgramConfig.fromAccountAddress(
    conn,
    configPda,
  );
  const creationFee = BigInt(cfg.multisigCreationFee.toString());
  note(
    `program config: multisigCreationFee=${creationFee} lamports, treasury=${cfg.treasury.toBase58()}`,
  );

  // ---- resume mode: the first run completed steps 1-3 (vault created +
  // funded, $0.25 swapped) but misread the SPCX balance due to a Helius
  // read lag. Reattach to the same vault instead of spending again.
  const resumeArg = process.argv.find((a) => a.startsWith("--resume="));
  let multisigPda: PublicKey;
  let vaultPda: PublicKey;

  if (resumeArg) {
    multisigPda = new PublicKey(resumeArg.slice("--resume=".length));
    [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
    pub("resumed test multisig PDA", multisigPda.toBase58());
    pub("resumed test vault PDA", vaultPda.toBase58());
    const ms = await multisig.accounts.Multisig.fromAccountAddress(
      conn,
      multisigPda,
    );
    const thr = (ms as unknown as { threshold?: number }).threshold;
    note(`resume: multisig exists onchain (threshold=${thr})`);
    const vaultLamports = await getBalanceLamports(vaultPda.toBase58());
    note(`resume: vault SOL balance=${vaultLamports} lamports`);
    if (vaultLamports < 5000) {
      fail(
        `resume: vault underfunded (${vaultLamports} lamports) — cannot pay inner execute fee`,
      );
    }
    // First run's actual SOL outflow for steps 1-3, carried into the budget.
    outflowLamports = 4_070_000;
    note("resume: seeded prior outflow 0.004070 SOL from the first run's actuals");
  } else {
    const createKey = Keypair.generate(); // throwaway, in-memory only
    [multisigPda] = multisig.getMultisigPda({
      createKey: createKey.publicKey,
    });
    [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
    pub("test multisig PDA (throwaway, NOT the treasury vault)", multisigPda.toBase58());
    pub("test vault PDA", vaultPda.toBase58());

  // ---- 1. create the test vault
  {
    const tx = multisig.transactions.multisigCreateV2({
      blockhash: await freshBlockhash(),
      treasury: cfg.treasury,
      createKey: createKey.publicKey,
      creator: scriptKey.publicKey,
      multisigPda,
      configAuthority: null,
      threshold: 1,
      members: [
        {
          key: scriptKey.publicKey,
          permissions: multisig.types.Permissions.all(),
        },
      ],
      timeLock: 0,
      rentCollector: scriptKey.publicKey,
    });
    tx.sign([scriptKey, createKey]);
    await sendTx("1. create test vault (multisigCreateV2)", tx, 0.0025, scriptKey);
  }

  // ---- 2. fund the vault (it pays the inner execute tx fee)
  await sendIx(
    "2. fund test vault (0.001 SOL)",
    [
      SystemProgram.transfer({
        fromPubkey: scriptKey.publicKey,
        toPubkey: vaultPda,
        lamports: VAULT_FUND_LAMPORTS,
      }),
    ],
    [scriptKey],
    0.00105,
    scriptKey,
  );

  // ---- 3. acquire dust SPCX via Jupiter
  const built = await jupBuild(SWAP_USDC_MICRO);
  if (built.kind !== "ok") {
    fail(
      `jupiter build failed at dust size ($0.25): [${built.kind}] ${built.reason}`,
    );
  }
  {
    const swapTx = await assembleVersionedTx(
      built.build,
      scriptKey.publicKey.toBase58(),
    );
    swapTx.sign([scriptKey]);
    await sendTx("3. jupiter USDC→SPCX ($0.25)", swapTx, 0.0025, scriptKey);
  }
  } // end else (fresh run: steps 1-3)

  const spcxBal = await tokenBalanceRetry(
    scriptKey.publicKey,
    MINTS.SPCX,
    "script SPCX after swap",
  );
  note(`script SPCX balance after swap: ${spcxBal} base units`);
  const dust = spcxBal - 200n >= DUST_TARGET ? DUST_TARGET : spcxBal - 200n;
  if (dust < 500n) {
    fail(
      `swap yielded only ${spcxBal} base units SPCX — too little for the vault test`,
    );
  }

  // ---- 4. create the vault's SPCX token account
  const scriptAta = getAssociatedTokenAddressSync(
    MINT,
    scriptKey.publicKey,
    false,
    T22,
  );
  const vaultAta = getAssociatedTokenAddressSync(MINT, vaultPda, true, T22);
  pub("script SPCX ATA", scriptAta.toBase58());
  pub("vault SPCX ATA", vaultAta.toBase58());
  await sendIx(
    "4. create vault SPCX ATA",
    [
      createAssociatedTokenAccountInstruction(
        scriptKey.publicKey,
        vaultAta,
        vaultPda,
        MINT,
        T22,
      ),
    ],
    [scriptKey],
    0.0025,
    scriptKey,
  );

  // ---- 5. transfer dust IN (receive leg)
  await sendIx(
    `5. transfer ${dust} SPCX into vault (receive)`,
    [
      createTransferCheckedInstruction(
        scriptAta,
        MINT,
        vaultAta,
        scriptKey.publicKey,
        dust,
        MINT_DECIMALS.SPCX,
        [],
        T22,
      ),
    ],
    [scriptKey],
    0.0001,
    scriptKey,
  );
  const vaultBalIn = await tokenBalanceRetry(vaultPda, MINTS.SPCX, "vault SPCX after receive");
  note(`vault SPCX balance after receive: ${vaultBalIn} base units`);
  if (vaultBalIn < dust - 10n) {
    fail(
      `vault did not receive SPCX: sent ${dust}, vault holds ${vaultBalIn} — ` +
        `Squads vault cannot hold Token-2022 SPCX (kill-line: plain-wallet fallback)`,
    );
  }

  // ---- 6. transfer back OUT via the full Squads proposal flow
  const ms = await multisig.accounts.Multisig.fromAccountAddress(conn, multisigPda);
  const txIndex = BigInt(ms.transactionIndex.toString()) + 1n;
  note(`multisig transactionIndex (read onchain, +1): ${txIndex}`);

  const innerIx = createTransferCheckedInstruction(
    vaultAta,
    MINT,
    scriptAta,
    vaultPda,
    dust,
    MINT_DECIMALS.SPCX,
    [],
    T22,
  );
  const innerMsg = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: await freshBlockhash(),
    instructions: [innerIx],
  });

  await sendIx(
    "6a. vaultTransactionCreate",
    [
      multisig.instructions.vaultTransactionCreate({
        multisigPda,
        transactionIndex: txIndex,
        creator: scriptKey.publicKey,
        vaultIndex: 0,
        ephemeralSigners: 0,
        transactionMessage: innerMsg,
      }),
    ],
    [scriptKey],
    0.003,
    scriptKey,
  );
  await sendIx(
    "6b. proposalCreate (isDraft: false)",
    [
      multisig.instructions.proposalCreate({
        multisigPda,
        creator: scriptKey.publicKey,
        transactionIndex: txIndex,
        isDraft: false,
      }),
    ],
    [scriptKey],
    0.0018,
    scriptKey,
  );
  await sendIx(
    "6c. proposalApprove",
    [
      multisig.instructions.proposalApprove({
        multisigPda,
        transactionIndex: txIndex,
        member: scriptKey.publicKey,
      }),
    ],
    [scriptKey],
    0.0001,
    scriptKey,
  );
  {
    // The execute builder fetches on-chain accounts; publicnode occasionally
    // 403s method families, so retry once against mainnet-beta before dying.
    const endpoints = [
      "https://solana-rpc.publicnode.com",
      "https://api.mainnet-beta.solana.com",
    ];
    let execTx: VersionedTransaction | null = null;
    let lastErr: unknown = null;
    for (const ep of endpoints) {
      try {
        execTx = await multisig.transactions.vaultTransactionExecute({
          connection: new Connection(ep, "confirmed"),
          blockhash: await freshBlockhash(),
          feePayer: scriptKey.publicKey,
          multisigPda,
          transactionIndex: txIndex,
          member: scriptKey.publicKey,
        });
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!execTx) {
      fail(
        `vaultTransactionExecute build failed: ${(lastErr as Error)?.message ?? lastErr}`,
      );
    }
    execTx.sign([scriptKey]);
    await sendTx("6d. vaultTransactionExecute", execTx, 0.0001, scriptKey);
  }

  // ---- verify the round trip
  // Final verification: poll until the reads reflect the execute (Helius
  // reads can lag the write node, and a stale NON-ZERO read would otherwise
  // false-negative). Expect the vault EMPTY and the script key whole again.
  let vaultBalOut = -1n;
  let scriptBalOut = -1n;
  for (let i = 0; i < 10; i++) {
    vaultBalOut = await tokenBalance(vaultPda, MINTS.SPCX);
    scriptBalOut = await tokenBalance(scriptKey.publicKey, MINTS.SPCX);
    if (vaultBalOut === 0n && scriptBalOut === spcxBal) break;
    await sleep(2500);
  }
  note(`vault SPCX balance after execute: ${vaultBalOut} base units`);
  note(`script SPCX balance after execute: ${scriptBalOut} base units`);
  if (vaultBalOut > 10n) {
    fail(
      `vault did not send SPCX: still holds ${vaultBalOut} base units after ` +
        `execute — Squads vault cannot send Token-2022 SPCX (kill-line: plain-wallet fallback)`,
    );
  }
  if (scriptBalOut < spcxBal - 10n) {
    fail(
      `script did not get SPCX back: had ${spcxBal}, now ${scriptBalOut} — ` +
        `funds unaccounted for`,
    );
  }

  verdict = "PASS";
  note(
    "PASS: test vault received, held, and sent Token-2022 SPCX via the full " +
      "Squads proposal flow. Wednesday's vault plan is unchanged.",
  );
  writeReport();
}

void main().catch((e: unknown) => {
  // Unexpected throw outside the abort/fail paths — record and stop.
  verdict = "ABORTED";
  note(`ABORT (unexpected): ${(e as Error).message}`);
  try {
    writeReport();
  } catch {
    /* report write itself failed — nothing more to do */
  }
  process.exit(2);
});
