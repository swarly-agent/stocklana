// lib/squads.ts — shared Squads v4 machinery for the money-moving scripts.
//
// Keypairs load from KEYS_DIR only (outside the git tree). Nothing here ever
// prints a secret — public keys and signatures go through lib/safe-log.ts.
//
// Reads use a plain Connection (getAccountInfo for multisig state, and the
// SDK's vaultTransactionExecute needs a Connection to rebuild the ALT list
// from the onchain transaction account). lib/rpc.ts stays the read-only
// helper; sends live here, gated behind --live in each script.

import fs from "node:fs";
import path from "node:path";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { KEYS_DIR, MINTS, PUBLIC_RPC_ENDPOINTS } from "./config.js";
import { pub } from "./safe-log.js";

export const SQUADS_PROGRAM_ID = multisig.PROGRAM_ID;

// ------------------------------------------------------------------ keypairs

export function keyPath(name: string): string {
  return path.join(KEYS_DIR, name);
}

/** Load a keypair from KEYS_DIR. Format: JSON array of 64 numbers. */
export function loadKeypair(name: string): Keypair {
  const raw = fs.readFileSync(keyPath(name), "utf8").trim();
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    throw new Error(`keypair file ${name} is not JSON (expected 64-number array)`);
  }
  if (
    !Array.isArray(arr) ||
    arr.length !== 64 ||
    !arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  ) {
    throw new Error(`keypair file ${name} malformed (expected 64-number JSON array)`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(arr as number[]));
}

/** Save a keypair to KEYS_DIR at 0600. Never logs the secret. */
export function saveKeypair(name: string, kp: Keypair): void {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(keyPath(name), JSON.stringify(Array.from(kp.secretKey)));
  fs.chmodSync(keyPath(name), 0o600);
  pub(`saved keypair (public key)`, kp.publicKey.toBase58());
}

export function keypairExists(name: string): boolean {
  return fs.existsSync(keyPath(name));
}

/**
 * Load a keypair from KEYS_DIR, generating one if absent.
 * Returns { kp, generated }. When `save` is true (default) a fresh keypair is
 * persisted at 0600; pass false for purely ephemeral keys.
 */
export function loadOrGenerateKeypair(
  name: string,
  save = true,
): { kp: Keypair; generated: boolean } {
  if (keypairExists(name)) return { kp: loadKeypair(name), generated: false };
  const kp = Keypair.generate();
  if (save) saveKeypair(name, kp);
  return { kp, generated: true };
}

// ---------------------------------------------------------------- connection

let cached: Connection | null = null;

// ------------------------------------------------------------------ resilient RPC

const RETRYABLE_STATUS = new Set([403, 429, 500, 502, 503, 504]);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * fetch wrapper for the Squads Connection: rotates across
 * PUBLIC_RPC_ENDPOINTS on 403/429/5xx/network errors, with exponential
 * backoff (1s/2s/4s) per endpoint before moving to the next. Observed
 * failure mode: a public endpoint answers getSlot while 403ing bursts of
 * indexed reads with a misleading "personal token" message; it recovers
 * after a short cooldown, so backoff-then-rotate is the right policy.
 */
async function resilientFetch(_input: unknown, init?: RequestInit): Promise<Response> {
  let lastErr = "";
  for (let e = 0; e < PUBLIC_RPC_ENDPOINTS.length; e++) {
    const endpoint = PUBLIC_RPC_ENDPOINTS[e]!;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: init?.body,
          signal: init?.signal,
        });
        if (!RETRYABLE_STATUS.has(res.status)) return res;
        lastErr = `HTTP ${res.status}`;
      } catch (err) {
        lastErr = (err as Error).message.slice(0, 120);
      }
      await sleep(1000 * 2 ** attempt);
    }
    console.log(`[squads] RPC endpoint struggling (${lastErr}) — rotating: ${endpoint}`);
  }
  throw new Error(`all RPC endpoints failing (last: ${lastErr})`);
}

/**
 * Connection for Squads reads (multisig state, ALT rebuild) and sends.
 * All RPC goes through resilientFetch (rotation + backoff); the startup
 * probe below just picks a sane initial endpoint and fails fast if none
 * answer at all. Separate from lib/rpc.ts, which is read-only by
 * construction.
 */
export async function getConnection(): Promise<Connection> {
  if (cached) return cached;
  const mk = (endpoint: string): Connection =>
    new Connection(endpoint, {
      commitment: "confirmed",
      fetch: resilientFetch as typeof fetch,
      disableRetryOnRateLimit: true, // resilientFetch owns the retry policy
    });
  let lastErr = "";
  for (const endpoint of PUBLIC_RPC_ENDPOINTS) {
    try {
      const candidate = mk(endpoint);
      // Probe with an indexed read (getAccountInfo), not getSlot: some
      // public endpoints answer getSlot while 403ing indexed methods.
      const probe = await candidate.getAccountInfo(new PublicKey(MINTS.USDC), "confirmed");
      if (!probe) throw new Error("USDC mint account not returned");
      cached = candidate;
      console.log(`[squads] RPC endpoint: ${endpoint}`);
      return candidate;
    } catch (e) {
      lastErr = (e as Error).message.slice(0, 160);
      console.log(`[squads] RPC endpoint unavailable, trying next: ${endpoint} (${lastErr})`);
    }
  }
  throw new Error(`no RPC endpoint reachable (last error: ${lastErr})`);
}

// ------------------------------------------------------------ multisig state

export interface MultisigState {
  transactionIndex: bigint;
  threshold: number;
}

/** Read the onchain multisig account. Throws if missing or undecodable. */
export async function readMultisigState(
  connection: Connection,
  multisigPda: PublicKey,
): Promise<MultisigState> {
  const info = await connection.getAccountInfo(multisigPda, "confirmed");
  if (!info) throw new Error(`multisig account not found: ${multisigPda.toBase58()}`);
  const disc = Buffer.from(multisig.accounts.multisigDiscriminator);
  if (!info.data.subarray(0, 8).equals(disc)) {
    throw new Error(`not a Squads multisig account: ${multisigPda.toBase58()}`);
  }
  const [state] = multisig.accounts.multisigBeet.deserialize(info.data.subarray(8));
  return {
    transactionIndex: BigInt(state.transactionIndex as unknown as string),
    threshold: Number(state.threshold),
  };
}

/** Next free transaction index = onchain counter + 1. Never hardcoded. */
export async function nextTransactionIndex(
  connection: Connection,
  multisigPda: PublicKey,
): Promise<bigint> {
  const s = await readMultisigState(connection, multisigPda);
  return s.transactionIndex + 1n;
}

// ------------------------------------------------------- tx build / send

const CU_CAP = 1_400_000;

export interface SimResult {
  ok: boolean;
  unitsConsumed?: number;
  err?: string;
}

/** Simulate an unsigned VersionedTransaction. Never sends. */
export async function simulateOnly(
  connection: Connection,
  tx: VersionedTransaction,
): Promise<SimResult> {
  try {
    const res = await connection.simulateTransaction(tx, { commitment: "confirmed" });
    if (res.value.err) {
      return { ok: false, err: JSON.stringify(res.value.err).slice(0, 500) };
    }
    return { ok: true, unitsConsumed: res.value.unitsConsumed ?? undefined };
  } catch (e) {
    return { ok: false, err: (e as Error).message.slice(0, 500) };
  }
}

function buildV0(
  payer: PublicKey,
  ixs: TransactionInstruction[],
  blockhash: string,
  luts: AddressLookupTableAccount[],
  computeUnits: number,
): VersionedTransaction {
  const withBudget = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ...ixs,
  ];
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: withBudget,
  }).compileToV0Message(luts);
  return new VersionedTransaction(msg);
}

export interface SendResult {
  signature: string | null;
  unitsConsumed: number | null;
  computeUnitsUsed: number;
}

/**
 * Two-phase send: simulate with a generous budget, then rebuild at
 * 1.2× consumed (capped at 1.4M — never hardcoded per-tx). In dry-run,
 * prints everything and sends nothing.
 */
export async function sendWithSizing(
  connection: Connection,
  ixs: TransactionInstruction[],
  payer: PublicKey,
  signers: Keypair[],
  opts: { label: string; dryRun: boolean; defaultUnits: number; luts?: AddressLookupTableAccount[] },
): Promise<SendResult> {
  const luts = opts.luts ?? [];
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const probe = buildV0(payer, ixs, blockhash, luts, CU_CAP);
  const sim = await simulateOnly(connection, probe);
  let units: number;
  if (sim.ok && sim.unitsConsumed != null) {
    units = Math.min(CU_CAP, Math.ceil(sim.unitsConsumed * 1.2));
    console.log(`[${opts.label}] simulated ${sim.unitsConsumed} CU → budget ${units}`);
  } else {
    units = opts.defaultUnits;
    console.log(
      `[${opts.label}] simulation inconclusive (${sim.err ?? "no units"}) — using default budget ${units}`,
    );
  }

  const tx = buildV0(payer, ixs, blockhash, luts, units);

  if (opts.dryRun) {
    console.log(`[${opts.label}] DRY-RUN — would send ${ixs.length} instruction(s), signed by:`);
    for (const s of signers) pub("  signer", s.publicKey.toBase58());
    console.log(`[${opts.label}] DRY-RUN — unsigned tx (first 120 chars): ${Buffer.from(tx.serialize()).toString("base64").slice(0, 120)}…`);
    return { signature: null, unitsConsumed: sim.unitsConsumed ?? null, computeUnitsUsed: units };
  }

  tx.sign(signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  pub(`[${opts.label}] sent`, sig);
  await connection.confirmTransaction(sig, "confirmed");
  pub(`[${opts.label}] confirmed`, sig);
  return { signature: sig, unitsConsumed: sim.unitsConsumed ?? null, computeUnitsUsed: units };
}

// ------------------------------------------- propose → approve → execute

export interface SquadsExecArgs {
  connection: Connection;
  multisigPda: PublicKey;
  vaultPda: PublicKey;
  memberKp: Keypair;
  /** Inner message the vault will execute; payer MUST be the vault PDA. */
  inner: TransactionMessage;
  /** ALT accounts referenced by the inner message (from the Jupiter build). */
  lutAccounts: AddressLookupTableAccount[];
  label: string;
  dryRun: boolean;
}

export interface SquadsExecResult {
  transactionIndex: bigint;
  batchSignature: string | null;
  executeSignature: string | null;
}

/**
 * Full Squads flow for one inner message:
 *   vaultTransactionCreate → proposalCreate (mandatory separate step,
 *   isDraft: false) → proposalApprove, batched in one outer tx (threshold 1),
 *   then vaultTransactionExecute (returns UNSIGNED — the SDK rebuilds the
 *   ALT account list from the onchain transaction account; the script signs
 *   as member + feePayer before sending).
 *
 * transactionIndex is read from the onchain multisig account — never
 * hardcoded. On collision (index taken between read and send), refetch and
 * retry, up to 3 attempts.
 */
export async function squadsProposeApproveExecute(
  args: SquadsExecArgs,
): Promise<SquadsExecResult> {
  const { connection, multisigPda, vaultPda, memberKp, inner, lutAccounts, label, dryRun } = args;
  const member = memberKp.publicKey;

  for (let attempt = 0; attempt < 3; attempt++) {
    const idx = await nextTransactionIndex(connection, multisigPda);
    console.log(`[${label}] attempt ${attempt + 1}: transactionIndex=${idx}`);

    const createIx = multisig.instructions.vaultTransactionCreate({
      multisigPda,
      transactionIndex: idx,
      creator: member,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage: inner,
      addressLookupTableAccounts: lutAccounts.length > 0 ? lutAccounts : undefined,
    });
    const proposalIx = multisig.instructions.proposalCreate({
      multisigPda,
      creator: member,
      transactionIndex: idx,
      isDraft: false,
    });
    const approveIx = multisig.instructions.proposalApprove({
      multisigPda,
      transactionIndex: idx,
      member,
    });

    // Probe the batch first so we can detect index collisions before sending.
    // Skipped entirely in dry-run: the probe must be signed, and dry-run
    // produces no signatures.
    if (!dryRun) {
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const probe = buildV0(member, [createIx, proposalIx, approveIx], blockhash, [], CU_CAP);
      probe.sign([memberKp]);
      const sim = await simulateOnly(connection, probe);
      if (!sim.ok) {
        const txPda = multisig.getTransactionPda({ multisigPda, index: idx })[0];
        const taken = await connection.getAccountInfo(txPda, "confirmed");
        if (taken) {
          console.log(`[${label}] index ${idx} taken by another transaction — refetching`);
          continue; // retry with a fresh index
        }
        throw new Error(`[${label}] batch simulation failed (index ${idx} not taken): ${sim.err}`);
      }
    }

    const batch = await sendWithSizing(
      connection,
      [createIx, proposalIx, approveIx],
      member,
      [memberKp],
      { label: `${label}/batch`, dryRun, defaultUnits: 400_000 },
    );

    if (dryRun) {
      console.log(`[${label}] DRY-RUN — execute step skipped (no onchain transaction to resolve ALT list from)`);
      console.log(`[${label}] DRY-RUN — inner message accounts: ${inner.instructions.length} instruction(s), payer=vault PDA`);
      return { transactionIndex: idx, batchSignature: null, executeSignature: null };
    }

    // Execute: the SDK fetches the onchain transaction account and rebuilds
    // the ALT account list — the returned instruction is UNSIGNED; the script
    // signs as member + feePayer before sending.
    const { instruction: execIx, lookupTableAccounts } =
      await multisig.instructions.vaultTransactionExecute({
        connection,
        multisigPda,
        transactionIndex: idx,
        member,
      });
    const exec = await sendWithSizing(
      connection,
      [execIx],
      member,
      [memberKp],
      { label: `${label}/execute`, dryRun: false, defaultUnits: 1_000_000, luts: lookupTableAccounts },
    );
    void vaultPda;
    return { transactionIndex: idx, batchSignature: batch.signature, executeSignature: exec.signature };
  }
  throw new Error(`[${label}] transactionIndex collision on 3 attempts — aborting`);
}

// ------------------------------------------------------------------- ATAs

const TOKEN_2022: PublicKey = TOKEN_2022_PROGRAM_ID;

/** ATA address for a mint/owner under the given token program. */
export function ataFor(
  mint: PublicKey,
  owner: PublicKey,
  programId: PublicKey,
): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, programId, ASSOCIATED_TOKEN_PROGRAM_ID);
}

/**
 * Token balance of an ATA, or null if the account does not exist.
 * RPC errors THROW — a balance read must never silently become 0, or a
 * transient outage would look like an empty wallet and either abort a real
 * run misleadingly or, worse, mis-size a transfer.
 */
export async function getTokenBalance(
  connection: Connection,
  ata: PublicKey,
): Promise<bigint | null> {
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (!info) return null;
  const b = await connection.getTokenAccountBalance(ata, "confirmed");
  return BigInt(b.value.amount);
}

/**
 * Idempotent ATA creation: returns the create ix if the ATA is missing,
 * null if it already exists. Payer funds the rent.
 */
export async function getOrCreateAtaIx(
  connection: Connection,
  payer: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  programId: PublicKey,
): Promise<TransactionInstruction | null> {
  const ata = ataFor(mint, owner, programId);
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (info) return null;
  return createAssociatedTokenAccountInstruction(
    payer,
    ata,
    owner,
    mint,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

export { TOKEN_2022 };
