// lib/jupiter.ts — shared Jupiter /swap/v2/build helpers (read-only use).
//
// Used by 00-falsifiers (quote + simulate) and, on Wednesday, by
// 02b-acquire-spcx / 05-allocate (instruction assembly for Squads proposals).
// Nothing here signs or sends. The API key is NOT handled here — the falsifier
// tries the keyless route first; Sting's key unblocks retries if walls appear.

import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { MINTS, TREASURY_WALLET, JUPITER_SLIPPAGE_BPS } from "./config.js";
import { rpcCall } from "./rpc.js";

const JUP_LITE_BUILD = "https://lite-api.jup.ag/swap/v2/build";
const JUP_PRO_BUILD = "https://api.jup.ag/swap/v2/build";
const JUP_TIMEOUT_MS = 15_000;

export interface JupBuild {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: string;
  /** which host served the build (lite-api or pro w/o key) */
  source: string;
  /** raw instruction components, exactly as Jupiter returned them */
  computeBudgetInstructions: unknown[];
  setupInstructions: unknown[];
  swapInstruction: unknown;
  cleanupInstruction: unknown | null;
  otherInstructions: unknown[];
  tipInstruction: unknown | null;
  addressesByLookupTableAddress: Record<string, string[]>;
  blockhash: string;
  rawShapeKeys: string[];
}

async function fetchText(url: string): Promise<{
  ok: boolean;
  status: number;
  body: string;
}> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), JUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function tryJson(body: string): unknown | null {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function summarizeRoutePlan(routePlan: unknown): string {
  if (!Array.isArray(routePlan)) return "(no routePlan)";
  return routePlan
    .map((step) => {
      const s = step as { swapInfo?: { label?: string } };
      return s.swapInfo?.label ?? "?";
    })
    .join(" -> ");
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

/**
 * Parse a /swap/v2/build response body into a JupBuild.
 * Returns { errorField } if Jupiter answered with an error payload,
 * null if the body is not a usable build response.
 */
function parseBuildResponse(
  body: string,
  source: string,
): { build: JupBuild } | { errorField: string } | null {
  const j = tryJson(body) as Record<string, unknown> | null;
  if (!j) return null;
  if (j["error"]) return { errorField: String(j["error"]).slice(0, 300) };
  if (j["inAmount"] == null || j["outAmount"] == null) return null;
  const lutRaw = (j["addressesByLookupTableAddress"] ?? {}) as Record<
    string,
    unknown
  >;
  const luts: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(lutRaw)) luts[k] = asStringArray(v);
  const bwm = (j["blockhashWithMetadata"] ?? {}) as { blockhash?: unknown };
  return {
    build: {
      inAmount: String(j["inAmount"]),
      outAmount: String(j["outAmount"]),
      otherAmountThreshold: String(j["otherAmountThreshold"] ?? "?"),
      priceImpactPct: String(j["priceImpactPct"] ?? "?"),
      slippageBps: Number(j["slippageBps"] ?? -1),
      routePlan: summarizeRoutePlan(j["routePlan"]),
      source,
      computeBudgetInstructions: Array.isArray(j["computeBudgetInstructions"])
        ? (j["computeBudgetInstructions"] as unknown[])
        : [],
      setupInstructions: Array.isArray(j["setupInstructions"])
        ? (j["setupInstructions"] as unknown[])
        : [],
      swapInstruction: j["swapInstruction"],
      cleanupInstruction: (j["cleanupInstruction"] as unknown) ?? null,
      otherInstructions: Array.isArray(j["otherInstructions"])
        ? (j["otherInstructions"] as unknown[])
        : [],
      tipInstruction: (j["tipInstruction"] as unknown) ?? null,
      addressesByLookupTableAddress: luts,
      blockhash: String(bwm.blockhash ?? ""),
      rawShapeKeys: Object.keys(j),
    },
  };
}

export type JupBuildResult =
  | { kind: "ok"; build: JupBuild }
  | { kind: "blocked"; reason: string }
  | { kind: "failed"; reason: string };

const excerpt = (body: string, n = 300): string => body.slice(0, n);

/**
 * GET /swap/v2/build for USDC→SPCX at an exact atomic-USDC amount.
 * Tries the keyless lite route first, then the pro host once WITHOUT a key
 * (no retry loops). A 200 from either with a usable build wins.
 *
 * @param taker the transaction payer Jupiter builds for — a vault PDA for
 *   the Squads flows (02b/05), the funded wallet for read-only quote/sim.
 * @param slippageBps explicit slippage; defaults to the config value.
 */
export async function jupBuild(
  amountAtomic: string,
  taker: string = TREASURY_WALLET,
  slippageBps: number = JUPITER_SLIPPAGE_BPS,
): Promise<JupBuildResult> {
  const params = new URLSearchParams({
    inputMint: MINTS.USDC,
    outputMint: MINTS.SPCX,
    amount: amountAtomic,
    taker,
    slippageBps: String(slippageBps),
    wrapAndUnwrapSol: "false", // irrelevant for USDC→SPCX; set deliberately
  });

  const lite = await fetchText(`${JUP_LITE_BUILD}?${params}`);
  if (lite.ok) {
    const parsed = parseBuildResponse(lite.body, "lite-api");
    if (parsed && "build" in parsed) return { kind: "ok", build: parsed.build };
    return {
      kind: "failed",
      reason: `lite-api 200 but unusable: ${parsed && "errorField" in parsed ? parsed.errorField : "non-JSON body"}`,
    };
  }
  const liteErr = `lite-api ${JUP_LITE_BUILD}: http ${lite.status} — ${excerpt(lite.body)}`;

  const pro = await fetchText(`${JUP_PRO_BUILD}?${params}`);
  if (pro.ok) {
    const parsed = parseBuildResponse(pro.body, "pro (no key)");
    if (parsed && "build" in parsed) return { kind: "ok", build: parsed.build };
    return {
      kind: "failed",
      reason: `${liteErr}\npro 200 but unusable: ${parsed && "errorField" in parsed ? parsed.errorField : "non-JSON body"}`,
    };
  }
  const proErr = `pro ${JUP_PRO_BUILD} (no key): http ${pro.status} — ${excerpt(pro.body)}`;

  const authWall = [lite.status, pro.status].some((s) =>
    [401, 403, 429].includes(s),
  );
  if (authWall) return { kind: "blocked", reason: `${liteErr}\n${proErr}` };
  return { kind: "failed", reason: `${liteErr}\n${proErr}` };
}

// ------------------------------------------------- instruction → tx assembly

interface JupInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64
}

function toInstruction(o: unknown): TransactionInstruction {
  const j = o as JupInstruction;
  return new TransactionInstruction({
    programId: new PublicKey(j.programId),
    keys: j.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(j.data, "base64"),
  });
}

const B58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Minimal base58 encoder (avoids a new dependency for one fallback path). */
function base58Encode(bytes: Uint8Array): string {
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes++;
  const digits: number[] = [];
  for (let i = zeroes; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! * 256;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeroes);
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]!];
  return out;
}

/**
 * Normalize a blockhash to base58. Jupiter's v2/build has been observed
 * returning blockhashWithMetadata.blockhash as comma-separated byte decimals
 * ("3,121,235,...") instead of base58 — handle both.
 */
function normalizeBlockhash(v: string): string {
  if (B58_RE.test(v)) return v;
  const parts = v.split(",").map((s) => Number(s.trim()));
  if (
    parts.length === 32 &&
    parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  ) {
    return base58Encode(Uint8Array.from(parts));
  }
  throw new Error(`unrecognized blockhash format: ${v.slice(0, 80)}`);
}

/**
 * The instruction components + ALT accounts of a JupBuild, without
 * assembling a transaction. 02b/05-allocate embed these in a Squads
 * vaultTransactionCreate inner message (payer = vault PDA).
 */
export interface SwapParts {
  instructions: TransactionInstruction[];
  lutAccounts: AddressLookupTableAccount[];
}

export function buildSwapParts(build: JupBuild): SwapParts {
  const parts: unknown[] = [
    ...build.computeBudgetInstructions,
    ...build.setupInstructions,
    build.swapInstruction,
    ...(build.cleanupInstruction ? [build.cleanupInstruction] : []),
    ...build.otherInstructions,
    ...(build.tipInstruction ? [build.tipInstruction] : []),
  ];
  const instructions = parts.map(toInstruction);
  const lutAccounts = Object.entries(build.addressesByLookupTableAddress).map(
    ([lutAddress, addresses]) =>
      new AddressLookupTableAccount({
        key: new PublicKey(lutAddress),
        state: {
          deactivationSlot: BigInt("18446744073709551615"), // active
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          authority: undefined,
          addresses: addresses.map((a) => new PublicKey(a)),
        },
      }),
  );
  return { instructions, lutAccounts };
}

/**
 * Assemble a JupBuild's instruction components into an UNSIGNED
 * VersionedTransaction for simulation (or for Wednesday's Squads proposals).
 * ALT address lists come straight from the build response — no LUT account
 * fetches needed. Order: computeBudget → setup → swap → cleanup? → other →
 * tip?. Never signs.
 */
export async function assembleVersionedTx(
  build: JupBuild,
  payer: string,
): Promise<VersionedTransaction> {
  const { instructions, lutAccounts } = buildSwapParts(build);

  let blockhash = "";
  try {
    blockhash = normalizeBlockhash(build.blockhash);
  } catch {
    blockhash = "";
  }
  if (!blockhash) {
    // Fallback: our own fresh blockhash via RPC (always base58).
    const lb = (await rpcCall("getLatestBlockhash", [
      { commitment: "confirmed" },
    ])) as { value: { blockhash: string } };
    blockhash = lb.value.blockhash;
  }

  const message = new TransactionMessage({
    payerKey: new PublicKey(payer),
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lutAccounts);
  return new VersionedTransaction(message);
}

/** Serialize an unsigned VersionedTransaction to base64 for simulateTransaction. */
export function txToBase64(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString("base64");
}
