/**
 * 06-snapshot.ts — reads all vaults and writes the dashboard snapshot (build spec §4/§6).
 *
 *  Pure reads: treasury + agent vault balances (SOL + token accounts on both
 *  the classic and Token-2022 programs), vesting ledger, recent signatures,
 *  mint configs, bounties. Includes sha256 of data/vesting-ledger.json and of
 *  policy/allocation-policy-v1.md. This file is what the demo video records
 *  against, and what the dashboard falls back to when live RPC reads fail.
 *
 *  Writes TWO files (same payload):
 *    dashboard/data.snapshot.json   — the live one the dashboard fetches
 *    data/snapshots/<unix-ts>.json  — the archived copy
 *  (Spec §6 and app.js expect dashboard/data.snapshot.json; the archive keeps
 *  history. Writing both satisfies both.)
 *
 *  Also maintains dashboard/aum-history.json — one {ts, usdc, spcx, sol,
 *  spcxMark, solMark, markSource} point per run (capped at 1000), which the
 *  F1 AUM-over-time chart reads. History honestly starts accumulating from
 *  the first run that includes this logic.
 *
 *  Snapshot additions (walkthrough 2026-09-23): `agents` (data-driven agent
 *  list — the dashboard never hardcodes agent names), `txRegistry` (from
 *  data/tx-registry.json — signature -> label/type/usdVolume/agent/ts; only
 *  labeled signatures appear on the Activity Wire), and `wireStartTs` (from
 *  data/wire.json — the wire shows only signatures at/after this time; null
 *  until the full-economics test sets it).
 *
 *  Read-only against chain; writes committed files only. No keypair needed.
 *  --dry-run: prints the snapshot payload, writes nothing.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MINTS, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../lib/config.js";
import { rpcCall } from "../lib/rpc.js";

const DRY_RUN = process.argv.includes("--dry-run");

const REPO_ROOT = path.join(import.meta.dirname ?? ".", "..");
const VAULTS_JSON = path.join(REPO_ROOT, "data", "vaults.json");
const AGENTS_JSON = path.join(REPO_ROOT, "data", "agents.json");
const TX_REGISTRY_JSON = path.join(REPO_ROOT, "data", "tx-registry.json");
const WIRE_JSON = path.join(REPO_ROOT, "data", "wire.json");
const LEDGER_JSON = path.join(REPO_ROOT, "data", "vesting-ledger.json");
const BOUNTIES_JSON = path.join(REPO_ROOT, "data", "bounties.json");
const POLICY_MD = path.join(REPO_ROOT, "policy", "allocation-policy-v2.md");
const SNAPSHOT_LIVE = path.join(REPO_ROOT, "dashboard", "data.snapshot.json");
const AUM_HISTORY_JSON = path.join(REPO_ROOT, "dashboard", "aum-history.json");
const SNAPSHOT_DIR = path.join(REPO_ROOT, "data", "snapshots");

const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUP_PRICE_URL = "https://lite-api.jup.ag/price/v3?ids=";

const sha256File = (p: string): string =>
  createHash("sha256").update(fs.readFileSync(p)).digest("hex");

interface TokenHolding {
  mint: string;
  program: string;
  amount: string;
  decimals: number;
  uiAmount: number | null;
}

async function tokenHoldings(owner: string): Promise<TokenHolding[]> {
  const out: TokenHolding[] = [];
  for (const [programId, label] of [
    [TOKEN_PROGRAM_ID, "token"],
    [TOKEN_2022_PROGRAM_ID, "token-2022"],
  ] as const) {
    const res = (await rpcCall("getTokenAccountsByOwner", [
      owner,
      { programId },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ])) as {
      value: {
        pubkey: string;
        account: { data: { parsed?: { info?: Record<string, unknown> } } };
      }[];
    };
    for (const acc of res.value ?? []) {
      const info = acc.account.data.parsed?.info as
        | { mint?: string; tokenAmount?: { amount?: string; decimals?: number; uiAmount?: number } }
        | undefined;
      if (!info?.mint) continue;
      out.push({
        mint: info.mint,
        program: label,
        amount: String(info.tokenAmount?.amount ?? "0"),
        decimals: Number(info.tokenAmount?.decimals ?? 0),
        uiAmount: info.tokenAmount?.uiAmount ?? null,
      });
    }
  }
  return out;
}

interface SigRow {
  signature: string;
  slot: number;
  blockTime: number | null;
}

async function recentSigs(address: string, limit = 10): Promise<SigRow[]> {
  const res = (await rpcCall("getSignaturesForAddress", [
    address,
    { limit, commitment: "confirmed" },
  ])) as { signature: string; slot: number; blockTime: number | null }[];
  return (res ?? []).map((s) => ({
    signature: s.signature,
    slot: s.slot,
    blockTime: s.blockTime,
  }));
}

async function mintSummary(mint: string): Promise<Record<string, unknown>> {
  try {
    const res = (await rpcCall("getAccountInfo", [
      mint,
      { encoding: "jsonParsed", commitment: "confirmed" },
    ])) as {
      value: {
        data: { parsed?: { info?: Record<string, unknown> }; program?: string };
      } | null;
    };
    const info = res?.value?.data?.parsed?.info ?? {};
    const ext = info["extensions"];
    return {
      program: String(res?.value?.data?.program ?? "?"),
      decimals: Number(info["decimals"] ?? -1),
      supply: String(info["supply"] ?? "?"),
      extensions: Array.isArray(ext)
        ? ext.map((e) => String((e as { extension?: unknown }).extension ?? "?"))
        : [],
    };
  } catch (e) {
    return { error: (e as Error).message.slice(0, 200) };
  }
}

/** Live Jupiter marks for SPCX + SOL (AUM history). Falls back to nulls. */
async function jupMarks(): Promise<{ spcx: number | null; sol: number | null }> {
  try {
    const res = await fetch(JUP_PRICE_URL + [MINTS.SPCX, SOL_MINT].join(","), {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { spcx: null, sol: null };
    const j = (await res.json()) as Record<string, { usdPrice?: number }>;
    return {
      spcx: j[MINTS.SPCX]?.usdPrice ?? null,
      sol: j[SOL_MINT]?.usdPrice ?? null,
    };
  } catch {
    return { spcx: null, sol: null };
  }
}

/** Append today's AUM point to dashboard/aum-history.json (capped, committed). */
function recordAumHistory(
  ts: number,
  usdc: number,
  spcx: number,
  sol: number,
  spcxMark: number | null,
  solMark: number | null,
  markSource: string,
): void {
  let hist: Record<string, unknown>[] = [];
  try {
    if (fs.existsSync(AUM_HISTORY_JSON)) {
      hist = JSON.parse(fs.readFileSync(AUM_HISTORY_JSON, "utf8")) as typeof hist;
      if (!Array.isArray(hist)) hist = [];
    }
  } catch {
    hist = [];
  }
  hist.push({ ts, usdc, spcx, sol, spcxMark, solMark, markSource });
  // cap: keep the most recent 1000 points
  if (hist.length > 1000) hist = hist.slice(hist.length - 1000);
  fs.writeFileSync(AUM_HISTORY_JSON, JSON.stringify(hist, null, 2) + "\n");
}

async function main(): Promise<void> {
  console.log(`[06-snapshot] dry-run=${DRY_RUN}`);
  const ts = Math.floor(Date.now() / 1000);

  let vaultAddrs: Record<string, { multisigPda: string; vaultPda: string }> = {};
  if (fs.existsSync(VAULTS_JSON)) {
    vaultAddrs = JSON.parse(fs.readFileSync(VAULTS_JSON, "utf8")) as typeof vaultAddrs;
  } else {
    console.log("[06-snapshot] data/vaults.json missing — vaults section will be empty (pre-01 state)");
  }

  const vaults: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(vaultAddrs)) {
    if (!v?.vaultPda) continue;
    console.log(`reading ${name} (${v.vaultPda})…`);
    const bal = (await rpcCall("getBalance", [v.vaultPda, { commitment: "confirmed" }])) as {
      value: number;
    };
    vaults[name] = {
      multisigPda: v.multisigPda,
      vaultPda: v.vaultPda,
      sol: bal.value / 1_000_000_000,
      tokens: await tokenHoldings(v.vaultPda),
      recentSigs: await recentSigs(v.vaultPda),
    };
  }

  const ledger = JSON.parse(fs.readFileSync(LEDGER_JSON, "utf8")) as { schedules: unknown[] };
  const bounties = JSON.parse(fs.readFileSync(BOUNTIES_JSON, "utf8")) as { bounties: unknown[] };

  // Agent registry: vault key -> {id, label} joined by vault PDA. Treasury is
  // not an agent. Data-driven: the dashboard never hardcodes agent names.
  let agentsReg: { id: string; label: string; vault: string }[] = [];
  try {
    if (fs.existsSync(AGENTS_JSON)) {
      agentsReg = (JSON.parse(fs.readFileSync(AGENTS_JSON, "utf8")) as { agents: typeof agentsReg }).agents ?? [];
    }
  } catch {
    agentsReg = [];
  }
  const createdTs = Number(
    (vaultAddrs as Record<string, unknown>)["createdTs"] ?? ts,
  );
  const agents = Object.entries(vaultAddrs)
    .filter(([name]) => name !== "treasury" && name !== "createdTs")
    .map(([key, v]) => {
      const reg = agentsReg.find((a) => a.vault === (v as { vaultPda?: string }).vaultPda);
      return {
        key,
        id: reg?.id ?? key,
        label: reg?.label ?? key,
        vaultPda: (v as { vaultPda?: string }).vaultPda,
        multisigPda: (v as { multisigPda?: string }).multisigPda,
        createdTs,
      };
    });

  // Transaction registry: signature -> {label, type, usdVolume, agent, ts}.
  // Only labeled signatures appear on the Activity Wire.
  let txRegistry: Record<string, unknown> = {};
  try {
    if (fs.existsSync(TX_REGISTRY_JSON)) {
      const raw = JSON.parse(fs.readFileSync(TX_REGISTRY_JSON, "utf8")) as Record<string, unknown>;
      delete raw["_note"];
      txRegistry = raw;
    }
  } catch {
    txRegistry = {};
  }

  // Activity Wire gate: only signatures at/after startTs are shown. Null until
  // the full-economics test sets it.
  let wireStartTs: number | null = null;
  try {
    if (fs.existsSync(WIRE_JSON)) {
      wireStartTs = (JSON.parse(fs.readFileSync(WIRE_JSON, "utf8")) as { startTs?: number | null }).startTs ?? null;
    }
  } catch {
    wireStartTs = null;
  }

  // AUM history point: platform totals + the marks used to value them.
  const marks = await jupMarks();
  let spcxMark = marks.spcx;
  let markSource = "jupiter-live";
  if (spcxMark == null) {
    // fallback: ledger-implied mark (treasury acquisition $12 -> 0.077702)
    const s0 = (ledger.schedules as { principalUsd?: unknown; principalAmount?: unknown }[])[0];
    spcxMark = s0 ? Number(s0.principalUsd) / Number(s0.principalAmount) : 154.44;
    markSource = "ledger-implied";
  }
  const tot = { usdc: 0, spcx: 0, sol: 0 };
  for (const v of Object.values(vaults)) {
    const vv = v as { sol?: number; tokens?: { mint: string; uiAmount: number | null; amount: string; decimals: number }[] };
    tot.sol += vv.sol ?? 0;
    for (const t of vv.tokens ?? []) {
      const amt = t.uiAmount ?? Number(t.amount) / Math.pow(10, t.decimals || 6);
      if (t.mint === MINTS.USDC) tot.usdc += amt;
      else if (t.mint === MINTS.SPCX) tot.spcx += amt;
    }
  }

  const snapshot = {
    snapshotTs: ts,
    generatedBy: "06-snapshot.ts",
    vaults,
    agents,
    txRegistry,
    wireStartTs,
    vesting: { schedules: ledger.schedules, sha256: sha256File(LEDGER_JSON) },
    policy: { file: "policy/allocation-policy-v2.md", sha256: sha256File(POLICY_MD) },
    bounties: bounties.bounties,
    mints: {
      SPCX: await mintSummary(MINTS.SPCX),
      ALLINU: await mintSummary(MINTS.ALLINU),
    },
  };

  console.log(JSON.stringify(snapshot, null, 2).slice(0, 3000));
  console.log(`… (${JSON.stringify(snapshot).length} bytes total)`);

  if (DRY_RUN) {
    console.log("[06-snapshot] DRY-RUN — nothing written.");
    return;
  }
  recordAumHistory(ts, tot.usdc, tot.spcx, tot.sol, spcxMark, marks.sol, markSource);
  console.log(`[06-snapshot] recorded AUM history point (mark: ${markSource})`);
  fs.mkdirSync(path.dirname(SNAPSHOT_LIVE), { recursive: true });
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const body = JSON.stringify(snapshot, null, 2) + "\n";
  fs.writeFileSync(SNAPSHOT_LIVE, body);
  const archived = path.join(SNAPSHOT_DIR, `${ts}.json`);
  fs.writeFileSync(archived, body);
  console.log(`[06-snapshot] wrote ${SNAPSHOT_LIVE}`);
  console.log(`[06-snapshot] archived ${archived}`);
}

void main().catch((e) => {
  console.error(`[06-snapshot] FATAL: ${(e as Error).message}`);
  process.exit(1);
});
