// lib/send.ts — SIGNED transaction submission for money-moving scripts.
//
// This module is intentionally separate from lib/rpc.ts, which is READ-ONLY
// by construction and must stay that way. Anything that signs or sends lives
// here.
//
// Auth: Helius via the workspace skill's helius_rpc.py (stored credential,
// surrogate auth — raw keys never appear here, in logs, or in reports).
// Secrets discipline: this module never handles key material; callers sign
// locally with keypairs loaded from out-of-tree files and pass only the
// serialized SIGNED transaction bytes. Print signatures + pubkeys only.

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

const HELIUS_RPC_PY = path.join(
  os.homedir(),
  "workspace/skills/helius/bin/helius_rpc.py",
);
const HELIUS_TIMEOUT_MS = 60_000;

function heliusCall(method: string, params: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(
      "python3",
      [HELIUS_RPC_PY, method, JSON.stringify(params)],
      { timeout: HELIUS_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `helius ${method} failed: ${(stderr || err.message).trim()}`,
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(
            new Error(
              `helius ${method} returned bad JSON: ${(e as Error).message}`,
            ),
          );
        }
      },
    );
  });
}

/**
 * Submit a fully-signed base64 VersionedTransaction.
 * Preflight runs (skipPreflight: false) — a failing simulation aborts the
 * send instead of landing a doomed transaction.
 * Returns the transaction signature.
 */
export async function sendSignedTx(base64Tx: string): Promise<string> {
  const sig = (await heliusCall("sendTransaction", [
    base64Tx,
    {
      encoding: "base64",
      preflightCommitment: "confirmed",
      skipPreflight: false,
    },
  ])) as unknown;
  if (typeof sig !== "string" || sig.length < 80) {
    throw new Error(`sendTransaction returned no signature: ${String(sig)}`);
  }
  return sig;
}

export interface ConfirmedTx {
  signature: string;
  slot: number;
  status: string;
}

/**
 * Poll getSignatureStatuses until the transaction reaches confirmed/finalized.
 * Throws on onchain error (err != null) or timeout — callers treat either as
 * a hard stop, never a retry.
 */
export async function confirmTx(
  signature: string,
  timeoutMs = 90_000,
): Promise<ConfirmedTx> {
  const start = Date.now();
  for (;;) {
    const res = (await heliusCall("getSignatureStatuses", [
      [signature],
      { searchTransactionHistory: false },
    ])) as {
      value: (
        | {
            slot: number;
            err: unknown;
            confirmationStatus: string | null;
          }
        | null
      )[];
    };
    const st = res?.value?.[0];
    if (st?.err != null) {
      throw new Error(
        `tx ${signature} failed onchain: ${JSON.stringify(st.err).slice(0, 400)}`,
      );
    }
    if (
      st?.confirmationStatus === "confirmed" ||
      st?.confirmationStatus === "finalized"
    ) {
      return { signature, slot: st.slot, status: st.confirmationStatus };
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`confirmation timeout after ${timeoutMs}ms: ${signature}`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}

/** Confirmed lamport balance of a pubkey. */
export async function getBalanceLamports(pubkey: string): Promise<number> {
  const res = (await heliusCall("getBalance", [
    pubkey,
    { commitment: "confirmed" },
  ])) as { value: number };
  if (typeof res?.value !== "number") {
    throw new Error(`getBalance returned bad value for ${pubkey}`);
  }
  return res.value;
}
