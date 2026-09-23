// lib/rpc.ts — shared READ-ONLY RPC helpers for scripts.
//
// Tier 1: Helius mainnet RPC via the workspace skill's helius_rpc.py
// (stored credential, surrogate auth — raw keys never appear here).
// Tier 2: public RPC endpoints with rotation + 8s timeout (dashboard pattern).
//
// READ-ONLY by construction: only get*/simulate methods are callable.
// Never add a send method to this module.

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

const HELIUS_RPC_PY = path.join(
  os.homedir(),
  "workspace/skills/helius/bin/helius_rpc.py",
);

const PUBLIC_RPC_ENDPOINTS = [
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];
const PUBLIC_RPC_TIMEOUT_MS = 8000;
const HELIUS_TIMEOUT_MS = 30_000;

/** Methods this helper will ever call. Anything else throws. */
const READ_ONLY_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getLatestBlockhash",
  "getSignaturesForAddress",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTransaction",
  "simulateTransaction",
]);

function heliusRpc(method: string, params: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(
      "python3",
      [HELIUS_RPC_PY, method, JSON.stringify(params)],
      { timeout: HELIUS_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(`helius_rpc.py failed: ${(stderr || err.message).trim()}`),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(
            new Error(`helius_rpc.py returned bad JSON: ${(e as Error).message}`),
          );
        }
      },
    );
  });
}

async function publicRpc(method: string, params: unknown[]): Promise<unknown> {
  let lastErr: unknown = null;
  for (const endpoint of PUBLIC_RPC_ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PUBLIC_RPC_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`http ${res.status}`);
      const json = (await res.json()) as {
        result?: unknown;
        error?: { message?: string };
      };
      if (json.error) throw new Error(json.error.message ?? "rpc error");
      return json.result;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("all public RPC endpoints failed");
}

/**
 * Read-only RPC call: Helius first, public endpoints as fallback.
 * Throws if the method is not on the read-only allowlist.
 */
export async function rpcCall(
  method: string,
  params: unknown[],
): Promise<unknown> {
  if (!READ_ONLY_METHODS.has(method)) {
    throw new Error(`refusing non-read-only RPC method: ${method}`);
  }
  try {
    return await heliusRpc(method, params);
  } catch (heliusErr) {
    try {
      return await publicRpc(method, params);
    } catch {
      // Prefer the Helius error — it is the primary route.
      throw heliusErr;
    }
  }
}
