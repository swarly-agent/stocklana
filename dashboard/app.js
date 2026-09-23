/*
 * MUSEX TERMINAL — dependency-free, zero build step.
 *
 * DATA POLICY: read-only. This file NEVER contains, requests, or transmits
 * any API key, secret, or private key. Live reads use PUBLIC RPC endpoints
 * only — the same endpoints anyone's browser can hit without a key.
 * NO API KEY IN BROWSER CODE — EVER.
 *
 * Two-tier data layer:
 *   Tier 1 (live): client-side fetch to public RPCs with rotation, 8s
 *     timeout, 60s in-memory cache. Vault addresses come from the committed
 *     snapshot (stable), balances/tokens/signatures read live. One flaky
 *     vault no longer forces snapshot mode — it falls back per-vault.
 *   Tier 2 (fallback): committed data.snapshot.json rendered with a visible
 *     "SNAPSHOT MODE" banner. The demo never shows a blank screen.
 *
 * Live stock quotes: Jupiter's public price API (no key, CORS-open), one
 * batch call for all Backpack Securities mints, refreshed every 60s. Baked
 * underlying-equity refs are fallback only. The SPCX valuation mark follows
 * the live quote so the AUM tape and the stocks tape always agree.
 */

"use strict";

/* ───────────────────────── constants ───────────────────────── */

const RPC_ENDPOINTS = [
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];
const RPC_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;

const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SPCX_MINT = "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb";
const MINT_LABELS = { [USDC_MINT]: "USDC", [SPCX_MINT]: "SPCX" };

// Treasury token accounts (recorded during mainnet setup, 2026-09-23)
const TREASURY_USDC_ATA = "Bsk1Ei2jEYQT9m6tHU7wjkxdx4mSa3jbyUwBApJ7XPE3";
const TREASURY_SPCX_ATA = "73UVXXtFXFMUGiGsdUWtRwq4Tj241Y4Kx7oJkh7txFXZ";

// Known transactions, labeled from the committed snapshot + session records.
const KNOWN_TX = {
  "5TQ2Cbr3tGFMhg4vqKBiKaK8J3whufyHBtpzmNfiMrgDyqeMs7d94FiN1TZLdxagiunhivsr5y8GzK7HTJCWgV1N":
    { label: "TREASURY SPCX ACQUISITION · $12 → 0.077702 SPCX", type: "acq" },
  "4u8yp6S8bDUePJz2agQrNoqjpcNzAAnf5kmHLeurNQRePnyHLWECYyrWpNkfa67ZkagVXKZ41zyNP81jWtRAB6XZ":
    { label: "AGENT-1 ALLOCATION · $5 USDC → 0.032377 SPCX", type: "alloc" },
};
// USD volume attributed to known swap transactions (verified session records).
const TX_USD_VOLUME = {
  "5TQ2Cbr3tGFMhg4vqKBiKaK8J3whufyHBtpzmNfiMrgDyqeMs7d94FiN1TZLdxagiunhivsr5y8GzK7HTJCWgV1N": 12,
  "4u8yp6S8bDUePJz2agQrNoqjpcNzAAnf5kmHLeurNQRePnyHLWECYyrWpNkfa67ZkagVXKZ41zyNP81jWtRAB6XZ": 5,
};

const REPO_URL = "https://github.com/swarly-agent/stocklana";
const POLICY_URL = REPO_URL + "/blob/main/policy/allocation-policy-v1.md";

/* __STOCK_QUOTES_START__ */
// Backpack Securities listings — UNDERLYING equity reference quotes (Yahoo Finance),
// baked 2026-09-23 ~13:05 ET. In the browser these are upgraded to LIVE onchain
// quotes per token mint via Jupiter's price API (refreshLiveQuotes); refs remain
// as fallback when the quote feed is unreachable. Tokens are 1:1-backed by the shares.
const STOCK_QUOTES_TS = "2026-09-23 ~13:05 ET";
const STOCK_QUOTES = [
  { sym: "SPCX", name: "SpaceX", mint: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb", px: 151.34, chgPct: -2.19 },
  { sym: "MU", name: "Micron Tech", mint: "MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1", px: 1067.94, chgPct: -2.58 },
  { sym: "SNDK", name: "SanDisk", mint: "SNDKbwMUQvZhnLnxLduradgLHG5KrPuKwpnrkkGRhfH", px: 1816.81, chgPct: -3.72 },
  { sym: "BA", name: "Boeing", mint: "BArimz1PcKZr8PcPh3tcZ2dg4S7FJLk3cw6R5F8GsHKg", px: 202.38, chgPct: 2.36 },
  { sym: "BABA", name: "Alibaba", mint: "BABANGA4JE7Kkam4nTrALAwAVgsNJUuFJnnkF7S16BZp", px: 110.78, chgPct: -4.76 },
  { sym: "COST", name: "Costco", mint: "CZEB3WNZuF2Yz1z2H81RcCk8T7fsw82KB33zqamASVsg", px: 900.2, chgPct: 0.09 },
  { sym: "DELL", name: "Dell", mint: "DELL2aRKQz7DMq5DrKLtkn47ZCnbxXPZXrSGbkmd13wy", px: 546.02, chgPct: -0.53 },
  { sym: "DJT", name: "Trump Media", mint: "DJTu7vi8norVzdVAffgvb39VP7wjKeTsgaMBJrzfxvoF", px: 9.07, chgPct: -3.31 },
  { sym: "HIMS", name: "Hims & Hers", mint: "HiMSSzzwkZkrXJ4PGVJRdtfLaANeAztjjcgk5Dxe7Lwx", px: 29.24, chgPct: -3.91 },
  { sym: "IBM", name: "IBM", mint: "BMKdM4yUxX12moFqVk195k7coMbaybd4RUKCUdm7D1Sk", px: 234.85, chgPct: 1.5 },
  { sym: "JNJ", name: "Johnson & Johnson", mint: "JNJg1znKdF712Phe7L7z52AATAvEjEytBdN2w8Lnh1Y", px: 266.89, chgPct: -0.85 },
  { sym: "LMT", name: "Lockheed Martin", mint: "LMT3i1BHgixFqPUgcyteJhnEz2dpy9i3cYy4pi9BoeV", px: 526.48, chgPct: 0.79 },
  { sym: "LULU", name: "Lululemon", mint: "LULUmT9VMttkfAJE236LXJcYJ2tTP7nunrSWR5G1BdS", px: 103.24, chgPct: -0.47 },
  { sym: "MGM", name: "MGM Resorts", mint: "MGMuubtUEirmkhfEQdmGUh4pr7HuUdMWcZXFtpPbVJD", px: 38.57, chgPct: -0.85 },
  { sym: "PFE", name: "Pfizer", mint: "PFER6ENqP8r8NF3CqVt4mFowxsin3V5MLidBNQFCC3x", px: 28.07, chgPct: 0.52 },
  { sym: "QUBT", name: "Quantum Computing", mint: "QUBTAD8C9bMU9LvmMNgKPhrmBGbHvxpu6vfWQtThxxw", px: 9.33, chgPct: 2.72 },
  { sym: "RBLX", name: "Roblox", mint: "RBLXDGRD64AtRamHMFVcjqne3Ar7NLWtFtYNtsrf1cE", px: 49.1, chgPct: -1.54 },
  { sym: "RDDT", name: "Reddit", mint: "RDDTGbhHwVXfyCvQMXzzowKjf5qrYBZAnehoXW83ooh", px: 150.79, chgPct: -3.13 },
  { sym: "RIVN", name: "Rivian", mint: "RcZmt84VMJv9bDhKqmw1uWDahYrUT468VwAChTnfD8p", px: 14.96, chgPct: -1.16 },
  { sym: "SHOP", name: "Shopify", mint: "SH55hfaipFAbwT42nQYhRoM5o5t61QpkmJ6p62vXB3m", px: 142.43, chgPct: -3.59 },
  { sym: "SNAP", name: "Snap", mint: "SNAPcESrvnH8yUdgeMF6xm1hym9b6hW6s8YeqeHdZFz", px: 5.31, chgPct: -5.52 },
  { sym: "UPS", name: "UPS", mint: "UPSqUeMHcWbkdg784XuBUEF9DtySSnW9ur5LAVdcuB9", px: 96.75, chgPct: 0.92 },
  { sym: "BULL", name: "Webull", mint: "BULL151gUXcFV5wXEUqu9Am2L7Qt4bTJRLRuAUjkcspC", px: 7.78, chgPct: -3.83 },
  { sym: "SKHY", name: "SK Hynix", mint: "SKHYhSjuRWHgikq8eRKbtBbpABgJSkd7ytQV14i9EQ3", px: null, chgPct: null },
  { sym: "CRWV", name: "CoreWeave", mint: "CRWVJeR2yEZuDUKYfGuKCHvLz8ywn4LGvovHfy5WiFmi", px: 88.17, chgPct: 3.21 },
  { sym: "COPX", name: "GX Copper Miners", mint: "CzLTZppPdZtTjyq3WGpHLstoc3GLhu7zH5Zg6xUa6Gv5", px: 86.58, chgPct: -1.04 },
  { sym: "TTWO", name: "Take-Two", mint: "TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo", px: 208.69, chgPct: -0.59 },
  { sym: "DKNG", name: "DraftKings", mint: "DKNGQFNGQmoBdXSRGKJ8tTu7uPDasw5JDcfMmWniNfow", px: 20.99, chgPct: -4.46 },
  { sym: "CYPH", name: "Cypherpunk Tech", mint: "CYPHuMmCL1GxJWa2tsPhLKykC7GrHJTCHwbXD4g5uawK", px: 3.55, chgPct: 4.43 },
  { sym: "IONQ", name: "IonQ", mint: "NQ5hSuXQZrbnrwcDVk2qN73njjd3E3v3badYHnj5thF", px: 43.05, chgPct: 6.27 },
  { sym: "BOT", name: "RoboStrategy", mint: "BoTx8y9ynfdxf5ZjWtCoBVkff52qKA82ysaLU8ZM6d8T", px: 28.3, chgPct: -3.68 },
  { sym: "URA", name: "GX Uranium ETF", mint: "URARfsinxCRw4JpvQhuT4CxavdZXZEMjv9ZwWmWpwag", px: 42.1, chgPct: -2.05 },
  { sym: "MSTR", name: "Strategy", mint: "MSTRdWXMeZxdE8osAQy3fA4rvTY5rgummDSMEx6U7Nz", px: 163.4, chgPct: -3.03 },
  { sym: "AMD", name: "AMD", mint: "AMD8XwJXgQ9WV45Wyj9yFLejxzf2J6VM1PJY8bJEjeES", px: 612.2, chgPct: -0.54 },
];
/* __STOCK_QUOTES_END__ */

/* ── live quote feed: onchain prices per token mint via Jupiter (no key, CORS-open) ── */
for (const q of STOCK_QUOTES) q.live = null;
const JUP_PRICE_URL = "https://lite-api.jup.ag/price/v3?ids=";
let quotesLiveAt = 0, quotesLiveCount = 0, quotesError = "", quotesUpgraded = false;

async function refreshLiveQuotes(ctx) {
  try {
    const r = await fetch(JUP_PRICE_URL + STOCK_QUOTES.map((q) => q.mint).join(","));
    if (!r.ok) throw new Error("http " + r.status);
    const j = await r.json();
    let n = 0;
    for (const q of STOCK_QUOTES) {
      const p = j[q.mint];
      if (p && p.usdPrice) { q.live = { px: p.usdPrice, chgPct: p.priceChange24h ?? 0 }; n++; }
    }
    quotesLiveAt = Date.now(); quotesLiveCount = n; quotesError = "";
    if (ctx && n > 0) {
      // Re-mark AUM to the live SPCX quote so the tapes agree on one price.
      const spcx = STOCK_QUOTES.find((x) => x.sym === "SPCX");
      if (spcx?.live?.px) {
        ctx.spcxMark = spcx.live.px;
        ctx.priceSource = "live";
        renderTapes(ctx);
        renderOverview(ctx);
        if (!quotesUpgraded) { quotesUpgraded = true; renderAgents(ctx); }
      }
    }
  } catch (e) {
    quotesError = e?.message ?? String(e);
    renderTapes(ctx);
  }
}

/* ───────────────────────── rpc tier ───────────────────────── */

const cache = new Map();

async function rpcCall(method, params) {
  const cacheKey = method + JSON.stringify(params);
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value;

  let lastErr = null;
  for (const endpoint of RPC_ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error("http " + res.status);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      cache.set(cacheKey, { ts: Date.now(), value: json.result });
      return json.result;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("all RPC endpoints failed");
}

const live = {
  balance: (address) =>
    rpcCall("getBalance", [address, { commitment: "confirmed" }]).then((r) => r.value / 1e9),
  tokenAccountsByOwner: (owner, programId) =>
    rpcCall("getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed" }]),
  signaturesForAddress: (address, limit = 12) =>
    rpcCall("getSignaturesForAddress", [address, { limit }]),
};

async function tokenHoldingsLive(owner) {
  const out = [];
  for (const [programId, label] of [[TOKEN_PROGRAM_ID, "spl-token"], [TOKEN_2022_PROGRAM_ID, "token-2022"]]) {
    const res = await live.tokenAccountsByOwner(owner, programId);
    for (const acc of res.value ?? []) {
      const info = acc.account.data.parsed?.info;
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

/* ───────────────────────── helpers ───────────────────────── */

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const shortAddr = (a) => (a && a.length > 12 ? a.slice(0, 4) + "…" + a.slice(-4) : a ?? "—");
const solscanAccount = (a) => "https://solscan.io/account/" + a;
const solscanTx = (s) => "https://solscan.io/tx/" + s;

function copyBtn(full) {
  return `<button class="copy-btn" data-copy="${esc(full)}" title="copy full address">⧉</button>`;
}
function addrCell(a) {
  if (!a) return "—";
  return `<span class="addr"><a href="${solscanAccount(a)}" target="_blank" rel="noopener">${esc(shortAddr(a))}</a>${copyBtn(a)}</span>`;
}
const txLink = (s) =>
  s ? `<a href="${solscanTx(s)}" target="_blank" rel="noopener" title="${esc(s)}">${esc(shortAddr(s))}</a>` : "—";

const fmtUsd = (n, d = 2) =>
  n == null || isNaN(n) ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtTok = (n, d = 6) =>
  n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d });
const fmtPct = (n) => (n == null || isNaN(n) ? "—" : (Number(n) * 100).toFixed(2) + "%");
/* All displayed times are America/New_York ("ET" — EDT in summer, EST in winter). */
const ET_TZ = "America/New_York";
function etParts(ts) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(ts * 1000));
  const g = (t) => parts.find((x) => x.type === t).value;
  return { y: g("year"), m: g("month"), d: g("day"), h: g("hour"), min: g("minute"), s: g("second") };
}
const et = (ts) => { const p = etParts(ts); return `${p.m}-${p.d} ${p.h}:${p.min}`; };
const etSec = (ts) => { const p = etParts(ts); return `${p.m}-${p.d} ${p.h}:${p.min}:${p.s}`; };
const etFull = (ts) => { const p = etParts(ts); return `${p.y}-${p.m}-${p.d} ${p.h}:${p.min}:${p.s}`; };

const tokenLabel = (mint) => MINT_LABELS[mint] ?? shortAddr(mint);
function tokenBalance(vault, mint) {
  const t = (vault.tokens ?? []).find((x) => x.mint === mint);
  return t ? t.uiAmount ?? Number(t.amount) / Math.pow(10, t.decimals || 6) : 0;
}

/** Vested fraction of a schedule at unix time `now` (0 before cliff, linear to 1). */
function vestedFraction(sched, now) {
  const start = Number(sched.startTs);
  const cliff = start + Number(sched.cliffDays) * 86400;
  const end = start + Number(sched.durationDays) * 86400;
  if (now < cliff) return 0;
  if (now >= end) return 1;
  return (now - start) / (end - start);
}

/** USD value of a vault: USDC + SPCX×implied (SOL excluded — rent/fees only). */
function vaultUsd(vault, spcxImplied) {
  return tokenBalance(vault, USDC_MINT) + tokenBalance(vault, SPCX_MINT) * spcxImplied;
}
function bountyUsd(b) {
  const p = b.payout ?? {};
  return (p.usdc ?? 0) + (p.spcxVesting ?? 0);
}

/* ───────────────────────── data boot ───────────────────────── */

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(path + ": http " + res.status);
  return res.json();
}
async function optional(p) { try { return await p; } catch { return null; } }

/**
 * Load every vault live, independently. A vault whose RPC reads fail keeps its
 * committed snapshot values and is reported in `degraded` — one flaky vault no
 * longer drags the whole terminal into snapshot mode.
 */
async function loadLiveVaults(snap) {
  const vaults = {};
  const degraded = [];
  await Promise.all(Object.entries(snap.vaults ?? {}).map(async ([name, v]) => {
    if (!v?.vaultPda) return;
    try {
      const [sol, tokens, sigs] = await Promise.all([
        live.balance(v.vaultPda),
        tokenHoldingsLive(v.vaultPda),
        live.signaturesForAddress(v.vaultPda, 12).catch(() => []),
      ]);
      vaults[name] = {
        multisigPda: v.multisigPda,
        vaultPda: v.vaultPda,
        sol,
        tokens,
        recentSigs: (sigs ?? []).map((s) => ({ signature: s.signature, slot: s.slot, blockTime: s.blockTime })),
      };
    } catch (e) {
      degraded.push({ name, error: e?.message ?? String(e) });
      vaults[name] = {
        multisigPda: v.multisigPda,
        vaultPda: v.vaultPda,
        sol: v.sol ?? 0,
        tokens: v.tokens ?? [],
        recentSigs: v.recentSigs ?? [],
      };
    }
  }));
  return { vaults, degraded };
}

/** Deduped recent signatures across all vaults, newest first. */
function allSigs(ctx) {
  const seen = new Map();
  for (const [vname, v] of Object.entries(ctx.vaults ?? {})) {
    for (const s of v.recentSigs ?? []) {
      if (s?.signature && !seen.has(s.signature)) seen.set(s.signature, { ...s, vault: vname });
    }
  }
  return [...seen.values()].sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
}

function txLabelFor(sig, ctx) {
  if (KNOWN_TX[sig]) return KNOWN_TX[sig];
  for (const s of ctx.vesting) {
    if (s.fundingTx === sig) return { label: s.id.toUpperCase() + " · VEST FUNDING", type: "vest" };
    if (s.matchTx === sig) return { label: s.id.toUpperCase() + " · EMPLOYER MATCH", type: "match" };
  }
  for (const b of ctx.bounties) {
    if (b.payoutTx === sig) return { label: b.id.toUpperCase() + " · USDC PAYOUT", type: "payout" };
  }
  return { label: "ONCHAIN ACTIVITY", type: "" };
}

/* ───────────────────────── renderers ───────────────────────── */

function setMode(mode, ts, note) {
  const dot = $("net-dot");
  const badge = $("mode-badge");
  const text = $("mode-text");
  const banner = $("snap-banner");
  const setDots = (cls) => {
    dot.className = "dot " + cls;
    badge.querySelector(".dot").className = "dot " + cls;
  };
  if (mode === "live") {
    setDots("live");
    text.textContent = "LIVE";
    text.style.color = "var(--green)";
    banner.hidden = true;
  } else if (mode === "connecting") {
    setDots("snap");
    text.textContent = "CONNECTING";
    text.style.color = "var(--amber)";
    banner.hidden = true;
  } else if (mode === "degraded") {
    setDots("snap");
    text.textContent = "LIVE*";
    text.style.color = "var(--amber)";
    banner.hidden = false;
    $("snap-text").innerHTML =
      `LIVE (DEGRADED) — ${esc(note ?? "some vaults unreadable")}. ` +
      `Affected balances fall back to the committed snapshot; everything else is live.`;
    $("retry-live").hidden = false;
  } else {
    // snapshot
    setDots("snap");
    text.textContent = "SNAPSHOT";
    text.style.color = "var(--amber)";
    banner.hidden = false;
    $("snap-text").innerHTML =
      `SNAPSHOT MODE — live RPC unreachable${note ? ` (${esc(note)})` : ""}. ` +
      `Showing committed onchain snapshot as of <strong>${etFull(ts)}</strong> ET. Balances may have moved since.`;
    $("retry-live").hidden = false;
  }
}

/** Re-run the live tier on demand (banner retry button). */
async function attemptLive() {
  if (!bootCtx) return;
  const ctx = bootCtx;
  setMode("connecting");
  try {
    const probe = ctx.vaults.treasury?.vaultPda;
    if (!probe) throw new Error("no treasury vault in snapshot");
    await live.balance(probe);
    const { vaults, degraded } = await loadLiveVaults(ctx.snapshot);
    ctx.vaults = vaults;
    ctx.mode = degraded.length ? "degraded" : "live";
    ctx.ts = Math.floor(Date.now() / 1000);
    for (const v of Object.values(ctx.vaults)) {
      for (const s of v.recentSigs ?? []) {
        if (s?.signature && s.blockTime) ctx.sigTs[s.signature] = s.blockTime;
      }
    }
    setMode(ctx.mode, ctx.ts, degraded.map((d) => `${d.name}: ${d.error}`).join("; "));
  } catch (e) {
    ctx.mode = "snapshot";
    const msg = e?.message ?? String(e);
    console.warn("live tier failed:", msg);
    setMode("snapshot", ctx.snapshot.snapshotTs, msg);
  }
  renderTapes(ctx);
  renderOverview(ctx);
  renderAgents(ctx);
  renderFeed(ctx);
}

function totals(ctx) {
  const t = ctx.vaults.treasury ?? {};
  const agents = ["agent1", "agent2"].map((k) => ctx.vaults[k]).filter(Boolean);
  const usdc = tokenBalance(t, USDC_MINT) + agents.reduce((s, v) => s + tokenBalance(v, USDC_MINT), 0);
  const spcx = tokenBalance(t, SPCX_MINT) + agents.reduce((s, v) => s + tokenBalance(v, SPCX_MINT), 0);
  const sol = (t.sol ?? 0) + agents.reduce((s, v) => s + (v.sol ?? 0), 0);
  return { usdc, spcx, sol, usd: usdc + spcx * ctx.spcxMark };
}

function renderTapes(ctx) {
  // ── tape 1 · exchange AUM + holdings ──
  const tot = totals(ctx);
  const mark = ctx.spcxMark;
  const markSrc = ctx.priceSource === "live" ? "LIVE" : "REF";
  const spcxUsd = tot.spcx * mark;
  const aumItems = [
    `<span class="k">TOTAL AUM</span> <span class="up"><b>${fmtUsd(tot.usd)}</b></span>`,
    `<span class="k">USDC</span> ${fmtTok(tot.usdc, 2)} <span class="k">·</span> <span class="up">${fmtUsd(tot.usdc)}</span>`,
    `<span class="k">SPCX</span> ${fmtTok(tot.spcx)} <span class="k">@</span> ${fmtUsd(mark)} <span class="k">${markSrc}</span> <span class="k">·</span> <span class="up">${fmtUsd(spcxUsd)}</span>`,
    `<span class="k">TREASURY</span> <span class="up">${fmtUsd(vaultUsd(ctx.vaults.treasury ?? {}, mark))}</span>`,
    `<span class="k">AGENT-1</span> <span class="up">${fmtUsd(vaultUsd(ctx.vaults.agent1 ?? {}, mark))}</span>`,
    `<span class="k">AGENT-2</span> <span class="up">${fmtUsd(vaultUsd(ctx.vaults.agent2 ?? {}, mark))}</span>`,
  ];
  const aumHalf = aumItems.map((i) => `<span class="tape-item">${i}<span class="sep">///</span></span>`).join("");
  $("tape-aum").innerHTML = aumHalf + aumHalf; // duplicated for seamless loop

  // ── tape 2 · Backpack Securities universe — live onchain where the feed is up ──
  const liveN = STOCK_QUOTES.filter((q) => q.live).length;
  const totalN = STOCK_QUOTES.length;
  const statusItem = liveN > 0
    ? `<span class="tape-item"><span class="up">● LIVE ${liveN}/${totalN} ONCHAIN · JUPITER · ${etSec(quotesLiveAt / 1000)} ET</span><span class="sep">///</span></span>`
    : `<span class="tape-item"><span class="k">○ REF ONLY · LIVE QUOTES UNREACHABLE${quotesError ? " (" + esc(quotesError) + ")" : ""} · UNDERLYING REF ${esc(STOCK_QUOTES_TS)}</span><span class="sep">///</span></span>`;
  const qItems = STOCK_QUOTES.map((q) => {
    const px = q.live ? q.live.px : q.px;
    const chg = q.live ? q.live.chgPct : q.chgPct;
    const src = q.live ? "live onchain quote via Jupiter" : `underlying reference ${STOCK_QUOTES_TS}, not an onchain quote`;
    const body = px == null
      ? `<span class="k">${esc(q.sym)}</span> <span class="dim">awaiting quote</span>`
      : `<span class="k">${esc(q.sym)}</span> ${fmtUsd(px)} ` +
        (chg == null ? `<span class="dim">—</span>`
          : `<span class="${chg >= 0 ? "up" : "down"}">${chg >= 0 ? "▲" : "▼"} ${Math.abs(chg).toFixed(2)}%</span>`);
    return `<span class="tape-item" title="${esc(q.name)} — ${esc(src)}">${body}<span class="sep">///</span></span>`;
  }).join("");
  const stockHalf = statusItem + qItems;
  $("tape-stocks").innerHTML = stockHalf + stockHalf;
}

function swapVolume24h(ctx) {
  const cutoff = ctx.ts - 86400;
  let n = 0, usd = 0;
  for (const s of allSigs(ctx)) {
    if (!s.blockTime || s.blockTime < cutoff) continue;
    const info = txLabelFor(s.signature, ctx);
    if (info.type === "acq" || info.type === "alloc") {
      n += 1;
      usd += TX_USD_VOLUME[s.signature] ?? 0;
    }
  }
  return { n, usd };
}

/* ── F1 · exchange overview ── */

function renderOverview(ctx) {
  const tot = totals(ctx);
  const t = ctx.vaults.treasury ?? {};
  const tUsdc = tokenBalance(t, USDC_MINT);
  const tSpcx = tokenBalance(t, SPCX_MINT);
  const a1 = ctx.vaults.agent1 ?? {};
  const a1Spcx = tokenBalance(a1, SPCX_MINT);

  // AUM
  $("ov-aum").innerHTML = `
    <span class="ov-k">TOTAL ASSETS · AUM</span>
    <div class="ov-v">${fmtUsd(tot.usd)}</div>
    <div class="ov-sub">
      <div class="row"><span>TREASURY</span><span class="num">${fmtTok(tUsdc, 2)} USDC · ${fmtTok(tSpcx)} SPCX</span></div>
      <div class="row"><span>AGENT-1</span><span class="num">${fmtTok(a1Spcx)} SPCX · ${fmtUsd(vaultUsd(a1, ctx.spcxMark))}</span></div>
      <div class="row"><span>POLICY</span><span class="num">70/30 · +10% match · −2% fee</span></div>
      <div class="row"><span class="dim">SPCX MARK</span><span class="num dim">${fmtUsd(ctx.spcxMark)} · ${ctx.priceSource === "live" ? "live onchain" : "broker ref"}</span></div>
      <div class="row"><span class="dim">ex SOL (rent/fees)</span><span class="num dim">${fmtTok(tot.sol, 4)} SOL</span></div>
    </div>`;

  // Asset mix
  const usdcUsd = tot.usdc;
  const spcxUsd = tot.spcx * ctx.spcxMark;
  const mixTotal = usdcUsd + spcxUsd || 1;
  $("ov-mix").innerHTML = `
    <span class="ov-k">ASSET MIX · USD</span>
    <div class="ov-v">${fmtUsd(mixTotal)}</div>
    <div class="mixbar" role="img" aria-label="asset mix">
      <div class="seg-usdc" style="width:${(usdcUsd / mixTotal * 100).toFixed(2)}%"></div>
      <div class="seg-spcx" style="width:${(spcxUsd / mixTotal * 100).toFixed(2)}%"></div>
    </div>
    <div class="mix-legend">
      <span><span class="swatch" style="background:var(--green)"></span>USDC <b>${fmtUsd(usdcUsd)}</b> ${(usdcUsd / mixTotal * 100).toFixed(1)}%</span>
      <span><span class="swatch" style="background:var(--amber)"></span>SPCX <b>${fmtUsd(spcxUsd)}</b> ${(spcxUsd / mixTotal * 100).toFixed(1)}%</span>
    </div>
    <div class="ov-sub"><div class="row"><span class="dim">SOL (rent/fees)</span><span class="num dim">${fmtTok(tot.sol, 4)}</span></div></div>`;

  // 24h activity
  const vol = swapVolume24h(ctx);
  const cutoff = ctx.ts - 86400;
  const newScheds = ctx.vesting.filter((s) => Number(s.startTs) >= cutoff).length;
  const tx24 = allSigs(ctx).filter((s) => s.blockTime && s.blockTime >= cutoff).length;
  $("ov-activity").innerHTML = `
    <span class="ov-k">24H ACTIVITY</span>
    <div class="ov-v" style="color:var(--green)">${tx24} <span style="font-size:13px;font-weight:400;color:var(--muted)">TXNS</span></div>
    <div class="ov-sub">
      <div class="row"><span>SWAPS</span><span class="num">${vol.n} · ${fmtUsd(vol.usd)} vol</span></div>
      <div class="row"><span>VESTING OPENED</span><span class="num">${newScheds} schedules</span></div>
      <div class="row"><span>REFERENCE</span><span class="num dim">${et(ctx.ts)} ET</span></div>
    </div>`;

  // Accounts
  const agents = ["agent1", "agent2"].filter((k) => ctx.vaults[k]);
  const activeVest = ctx.vesting.filter((s) => String(s.status).toLowerCase() === "active").length;
  $("ov-accounts").innerHTML = `
    <span class="ov-k">ACCOUNTS</span>
    <div class="ov-v">${agents.length} <span style="font-size:13px;font-weight:400;color:var(--muted)">AGENTS</span></div>
    <div class="ov-sub">
      <div class="row"><span>AGENT-1</span><span class="num" style="color:var(--green)">ACTIVE · ${fmtUsd(vaultUsd(ctx.vaults.agent1 ?? {}, ctx.spcxMark))}</span></div>
      <div class="row"><span>AGENT-2</span><span class="num dim">NEW · ${fmtUsd(vaultUsd(ctx.vaults.agent2 ?? {}, ctx.spcxMark))}</span></div>
      <div class="row"><span>VESTING</span><span class="num">${activeVest} active schedules</span></div>
    </div>`;
}

/* ── F2 · agent accounts (collapsible) ── */

function schedStatus(s, now) {
  const start = Number(s.startTs);
  const cliffTs = start + Number(s.cliffDays) * 86400;
  if (now < cliffTs) return { txt: "IN CLIFF", color: "var(--red)", sub: `first release in ${((cliffTs - now) / 86400).toFixed(1)}d` };
  const frac = vestedFraction(s, now);
  if (frac >= 1) return { txt: "FULLY VESTED", color: "var(--green)", sub: "complete" };
  const day = Math.floor((now - start) / 86400);
  return { txt: `VESTING · DAY ${day}/${s.durationDays}`, color: "var(--blue)", sub: `${fmtPct(frac)} vested` };
}

function schedHtml(s, ctx) {
  const now = ctx.ts;
  const start = Number(s.startTs);
  const end = start + Number(s.durationDays) * 86400;
  const frac = vestedFraction(s, now);
  const total = Number(s.principalAmount) + Number(s.matchAmount);
  const vested = total * frac;
  const elapsedPct = Math.min(100, Math.max(0, (now - start) / (end - start) * 100));
  const cliffPct = (Number(s.cliffDays) / Number(s.durationDays) * 100).toFixed(2);
  const st = schedStatus(s, now);
  return `<div class="vest-sched">
    <div class="vest-top">
      <span class="vest-id">${esc(s.id)}</span>
      <span class="muted">90d linear · 7d cliff</span>
    </div>
    <div class="timeline">
      <div class="elapsed" style="width:${elapsedPct.toFixed(2)}%"></div>
      <div class="vested" style="width:${(frac * 100).toFixed(2)}%"></div>
      <div class="cliff" style="left:${cliffPct}%"></div>
      <div class="now" style="left:${elapsedPct.toFixed(2)}%"></div>
      <div class="end-cap"></div>
    </div>
    <div class="ticks"><span>DAY 0 · ${et(start)}</span><span>CLIFF · DAY ${s.cliffDays}</span><span>DAY ${s.durationDays} · ${et(end)}</span></div>
    <div class="vest-meta">
      <strong style="color:${st.color}">${st.txt}</strong> · ${esc(st.sub)}<br>
      vested <strong style="color:var(--text)">${fmtTok(vested)} / ${fmtTok(total)} SPCX</strong><br>
      principal ${fmtTok(s.principalAmount)} SPCX (${fmtUsd(s.principalUsd)}) + match ${fmtTok(s.matchAmount)} SPCX (${fmtUsd(s.matchUsd)})<br>
      fund ${txLink(s.fundingTx)} · match ${txLink(s.matchTx)}<br>
      <span class="dim">enforcement: ${esc(s.enforcement ?? "ledger-manual — disclosed, not a program")}</span>
    </div>
  </div>`;
}

function renderAgents(ctx) {
  const order = ["agent1", "agent2"];
  const ids = { agent1: "agent-1", agent2: "agent-2" };
  $("agents-meta").textContent = order.filter((k) => ctx.vaults[k]).length + " squads vaults · click to expand";

  $("agents-body").innerHTML = order.map((key, i) => {
    const v = ctx.vaults[key];
    if (!v) return "";
    const id = ids[key];
    const label = ctx.agentLabels[id] ?? id;
    const usdc = tokenBalance(v, USDC_MINT);
    const spcx = tokenBalance(v, SPCX_MINT);
    const acctUsd = vaultUsd(v, ctx.spcxMark);
    const scheds = ctx.vesting.filter((s) => s.agent === id);
    const earned = ctx.bounties.filter((b) => b.claimant === id);
    const active = spcx > 0 || usdc > 0 || scheds.length > 0;

    const vestHtml = scheds.length
      ? scheds.map((s) => schedHtml(s, ctx)).join("")
      : `<p class="empty-note">no vesting schedules — complete a bounty to open one.</p>`;

    const earnHtml = earned.length
      ? earned.map((b) => {
          const p = b.payout ?? {};
          const matchUsd = (p.spcxVesting ?? 0) * ((p.matchBps ?? 0) / 10000);
          const paidTs = b.payoutTx ? ctx.sigTs?.[b.payoutTx] : null;
          return `<div class="earn-row">
            <span><code>${esc(b.id)}</code> · ${esc(b.title)}<br>
            <span class="muted small">paid ${paidTs ? et(paidTs) + " ET" : "—"}</span></span>
            <span class="num"><span style="color:var(--green)">${fmtUsd(p.usdc)} USDC</span><br>
            <span style="color:var(--amber)">${fmtUsd(p.spcxVesting)} SPCX</span> <span class="dim small">vested</span><br>
            <span class="dim small">+${fmtUsd(matchUsd)} match</span><br>
            <span class="small">${txLink(b.payoutTx)}</span></span>
          </div>`;
        }).join("")
      : `<p class="empty-note">no earnings yet — claim a bounty to fund this account.</p>`;

    const swapHtml = (v.recentSigs ?? []).length
      ? (v.recentSigs ?? []).slice(0, 8).map((s) => {
          const info = txLabelFor(s.signature, ctx);
          return `<div class="earn-row">
            <span class="feed-type ${info.type}">${info.type ? info.type.toUpperCase() : "TX"}</span>
            <span style="flex:1">${esc(info.label)}</span>
            <span class="small">${txLink(s.signature)}</span>
          </div>`;
        }).join("")
      : `<p class="empty-note">no onchain history yet.</p>`;

    return `<div class="agent-card" data-agent="${id}">
      <div class="agent-head" role="button" tabindex="0" aria-expanded="false">
        <span class="status-dot ${active ? "on" : "idle"}"></span>
        <span class="agent-id">AGENT-${i + 1}</span>
        <span class="agent-label">${esc(label)}</span>
        <span class="chev">▸</span>
      </div>
      <div class="agent-summary">
        <div class="sum-cell"><span class="k">ACCOUNT VALUE</span><span class="v">${fmtUsd(acctUsd)}</span></div>
        <div class="sum-cell"><span class="k">SPCX</span><span class="v" style="color:var(--amber)">${fmtTok(spcx)}</span></div>
        <div class="sum-cell"><span class="k">USDC</span><span class="v" style="color:var(--green)">${fmtTok(usdc, 2)}</span></div>
        <div class="sum-cell"><span class="k">SOL</span><span class="v">${fmtTok(v.sol, 4)}</span></div>
        <div class="sum-cell"><span class="k">VESTING</span><span class="v">${scheds.length}</span></div>
        <div class="sum-cell"><span class="k">EARNED</span><span class="v">${earned.length} ${earned.length === 1 ? "bounty" : "bounties"}</span></div>
      </div>
      <div class="agent-detail">
        <div class="agent-sec">
          <h4>ADDRESSES</h4>
          <table class="addr-table"><tbody>
            <tr><td class="lbl">VAULT PDA</td><td>${addrCell(v.vaultPda)}</td></tr>
            <tr><td class="lbl">MULTISIG</td><td>${addrCell(v.multisigPda)}</td></tr>
          </tbody></table>
        </div>
        <div class="agent-sec">
          <h4>VESTING SCHEDULES · ${scheds.length}</h4>
          ${vestHtml}
        </div>
        <div class="agent-sec">
          <h4>EARNINGS HISTORY</h4>
          ${earnHtml}
        </div>
        <div class="agent-sec">
          <h4>ONCHAIN HISTORY</h4>
          ${swapHtml}
        </div>
      </div>
    </div>`;
  }).join("");
}

/* ── F3 · activity wire ── */

const FEED_ICONS = { acq: "◈", alloc: "⇄", payout: "$", vest: "◐", match: "+", bounty: "◎" };

/* ── wire filters + grouping state ── */

const FEED_FILTERS = [
  { id: "all",     label: "ALL" },
  { id: "swaps",   label: "SWAPS",   types: ["acq", "alloc"] },
  { id: "payouts", label: "PAYOUTS", types: ["payout"] },
  { id: "vesting", label: "VESTING", types: ["vest"] },
  { id: "matches", label: "MATCHES", types: ["match"] },
  { id: "bounties",label: "BOUNTIES",types: ["bounty"] },
];
let feedFilter = "all";
let feedCtx = null;

// Group key for a signature: bounty lifecycles, swaps, or ungrouped.
function groupForSig(sig, ctx) {
  for (const b of ctx.bounties) {
    if (b.payoutTx === sig) return "g-" + b.id;
  }
  for (const s of ctx.vesting) {
    const key = String(s.id ?? "").replace(/^vest-/, "");
    if (s.fundingTx === sig || s.matchTx === sig) return "g-" + key;
  }
  const info = KNOWN_TX[sig];
  if (info && (info.type === "acq" || info.type === "alloc")) return "g-swaps";
  return null;
}

function groupTitle(key, ctx) {
  if (key === "g-swaps") return "TREASURY + AGENT SWAPS";
  if (key === "g-vesting") return "VESTING STATUS · LIVE";
  const id = String(key).replace(/^g-/, "");
  const b = ctx.bounties.find((x) => x.id === id);
  if (b) return `${b.id.toUpperCase()} LIFECYCLE · ${esc(b.title)}`;
  return id.toUpperCase();
}

function feedDescribe(sig, ctx) {
  const info = txLabelFor(sig, ctx);
  if (info.type === "acq") return "TREASURY ACQUIRED 0.077702 SPCX FOR $12 USDC VIA JUPITER";
  if (info.type === "alloc") return "AGENT-1 SWAPPED $5 USDC → 0.032377 SPCX · POLICY-VALIDATED";
  for (const b of ctx.bounties) {
    if (b.payoutTx === sig) {
      const p = b.payout ?? {};
      const matchUsd = (p.spcxVesting ?? 0) * ((p.matchBps ?? 0) / 10000);
      return `${b.id.toUpperCase()} PAID ${fmtUsd(bountyUsd(b))} → ${esc(b.claimant ?? "?").toUpperCase()} · ${fmtUsd(p.usdc)} USDC + ${fmtUsd(p.spcxVesting)} SPCX VESTED + ${fmtUsd(matchUsd)} MATCH`;
    }
  }
  for (const s of ctx.vesting) {
    if (s.fundingTx === sig) return `${s.id.toUpperCase()} FUNDED · ${fmtTok(s.principalAmount)} SPCX → 90D VEST · 7D CLIFF`;
    if (s.matchTx === sig) return `EMPLOYER MATCH · ${fmtTok(s.matchAmount)} SPCX → ${s.id.toUpperCase()}`;
  }
  return info.label;
}

function feedItemHtml(e) {
  return `<div class="feed-item">
    <span class="feed-ts">${et(e.ts)}${e.live ? " ·" : ""}</span>
    <span class="feed-type ${e.type}">${FEED_ICONS[e.type] ?? ""} ${e.type.toUpperCase()}</span>
    <span class="feed-body">${e.body}${e.sig ? `<span class="sig">${txLink(e.sig)}</span>` : ""}</span>
  </div>`;
}

function renderFeed(ctx) {
  feedCtx = ctx;
  const now = ctx.ts;
  const events = [];

  for (const s of allSigs(ctx)) {
    if (!s.blockTime) continue;
    const info = txLabelFor(s.signature, ctx);
    if (!info.type) continue; // wire shows labeled protocol events only
    events.push({
      ts: s.blockTime,
      type: info.type,
      body: feedDescribe(s.signature, ctx),
      sig: s.signature,
      group: groupForSig(s.signature, ctx),
    });
  }

  for (const b of ctx.bounties) {
    if (!b.postedTs) continue;
    events.push({
      ts: b.postedTs,
      type: "bounty",
      body: `BOUNTY POSTED · ${b.id.toUpperCase()} — ${esc(b.title)} (${fmtUsd(bountyUsd(b))})`,
      sig: null,
      group: "g-" + b.id,
    });
  }

  for (const s of ctx.vesting) {
    const start = Number(s.startTs);
    const cliffTs = start + Number(s.cliffDays) * 86400;
    const total = Number(s.principalAmount) + Number(s.matchAmount);
    const frac = vestedFraction(s, now);
    const day = Math.max(0, Math.floor((now - start) / 86400));
    const txt = now < cliffTs
      ? `${s.id.toUpperCase()} · DAY ${day}/${s.durationDays} · <span class="feed-now">IN CLIFF</span> — first release in ${((cliffTs - now) / 86400).toFixed(1)}d`
      : `${s.id.toUpperCase()} · DAY ${day}/${s.durationDays} · ${fmtTok(total * frac)} / ${fmtTok(total)} SPCX VESTED (${fmtPct(frac)})`;
    events.push({ ts: now, type: "vest", body: txt, sig: null, live: true, group: "g-vesting" });
  }

  events.sort((a, b) => b.ts - a.ts);

  // apply the active type filter
  const f = FEED_FILTERS.find((x) => x.id === feedFilter) ?? FEED_FILTERS[0];
  const shown = f.types ? events.filter((e) => f.types.includes(e.type)) : events;
  const list = shown.slice(0, 20);

  // collect groups, preserving newest-first order
  const groups = new Map();
  for (const e of list) {
    if (!e.group) continue;
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }
  const expand = f.id !== "all"; // a filter is on: show what's inside
  const seen = new Set();
  let html = "";
  for (const e of list) {
    if (e.group) {
      if (seen.has(e.group)) continue;
      seen.add(e.group);
      const evs = groups.get(e.group);
      const open = expand ? " open" : "";
      html += `<div class="feed-group${open}" data-group="${esc(e.group)}">
        <div class="group-head" role="button" tabindex="0" aria-expanded="${expand}">
          <span class="chev">▸</span>
          <span class="group-title">${groupTitle(e.group, ctx)}</span>
          <span class="group-count">${evs.length} event${evs.length === 1 ? "" : "s"}</span>
          <span class="group-ts">${et(evs[0].ts)}</span>
        </div>
        <div class="group-body">${evs.map(feedItemHtml).join("")}</div>
      </div>`;
    } else {
      html += feedItemHtml(e);
    }
  }

  const chips = FEED_FILTERS.map((x) =>
    `<button class="chip${x.id === feedFilter ? " active" : ""}" data-feed-filter="${x.id}">${x.label}</button>`).join("");

  $("feed-meta").textContent = f.id === "all"
    ? `${events.length} events · newest first`
    : `${list.length} of ${events.length} events · ${f.label}`;
  $("feed-body").innerHTML = list.length
    ? `<div class="feed-filters" role="group" aria-label="filter activity">${chips}</div><div class="feed">${html}</div>`
    : `<div class="feed-filters" role="group" aria-label="filter activity">${chips}</div><p class="loading">no activity for this filter.</p>`;
}

/* ── F4 · bounty board ── */

function renderBounties(ctx) {
  const paid = ctx.bounties.filter((b) => String(b.status).toLowerCase() === "paid");
  const open = ctx.bounties.filter((b) => String(b.status).toLowerCase() !== "paid");
  $("bounties-meta").textContent = `${paid.length}/${ctx.bounties.length} paid · verifier: program operator`;

  const paidRows = paid.map((b) => {
    const p = b.payout ?? {};
    const matchUsd = (p.spcxVesting ?? 0) * ((p.matchBps ?? 0) / 10000);
    return `<tr>
      <td><code>${esc(b.id)}</code></td>
      <td><strong>${esc(b.title)}</strong><br><span class="muted small">${esc(b.acceptanceCriteria ?? "")}</span>
        ${b.note ? `<br><span class="dim small">◈ ${esc(b.note)}</span>` : ""}</td>
      <td class="num"><span style="color:var(--green)">${fmtUsd(p.usdc)} USDC</span><br>
        <span style="color:var(--amber)">${fmtUsd(p.spcxVesting)} SPCX</span> <span class="dim">vested</span><br>
        <span class="dim small">+${fmtUsd(matchUsd)} match · −${((p.feeBps ?? 0) / 100).toFixed(0)}% fee</span></td>
      <td><span class="pill paid">PAID</span></td>
      <td><span class="muted small">${esc(b.claimant ?? "")}</span><br>${txLink(b.payoutTx)}<br>
        ${b.evidenceUrl ? `<a href="${esc(b.evidenceUrl)}" target="_blank" rel="noopener" class="small">evidence ↗</a>` : ""}</td>
    </tr>`;
  }).join("");

  const openRows = open.map((b) => {
    const p = b.payout ?? {};
    return `<tr>
      <td><code>${esc(b.id)}</code></td>
      <td><strong>${esc(b.title)}</strong><br><span class="muted small">${esc(b.acceptanceCriteria ?? "")}</span></td>
      <td class="num"><span style="color:var(--green)">${fmtUsd(p.usdc)} USDC</span><br>
        <span style="color:var(--amber)">${fmtUsd(p.spcxVesting)} SPCX</span> <span class="dim">vested</span></td>
      <td><span class="pill open">OPEN</span></td>
      <td><div class="claim-box">${esc(b.howToClaim ?? "")}<br><br>
        <a href="${REPO_URL}" target="_blank" rel="noopener">OPEN A PR ↗</a> <span class="dim">— first merged wins</span></div></td>
    </tr>`;
  }).join("");

  $("bounties-body").innerHTML = `
    <div class="board-sec">
      <h3><span style="color:var(--amber)">▸ OPEN</span><span class="count">${open.length} bounties · claimable now</span></h3>
      ${open.length ? `<table class="term"><thead><tr><th>ID</th><th>BOUNTY</th><th class="num">PAYOUT</th><th>STATUS</th><th>CLAIM</th></tr></thead><tbody>${openRows}</tbody></table>`
        : `<p class="empty-note">no open bounties right now.</p>`}
    </div>
    <div class="board-sec">
      <h3><span style="color:var(--green)">▸ COMPLETED</span><span class="count">${paid.length} paid out</span></h3>
      ${paid.length ? `<table class="term"><thead><tr><th>ID</th><th>BOUNTY</th><th class="num">PAYOUT</th><th>STATUS</th><th>CLAIMANT</th></tr></thead><tbody>${paidRows}</tbody></table>`
        : `<p class="empty-note">no completed bounties yet.</p>`}
    </div>`;
}

/* ───────────────────────── chrome ───────────────────────── */

function startClock() {
  const el = $("et-clock");
  const tick = () => {
    const p = etParts(Math.floor(Date.now() / 1000));
    el.textContent = `${p.h}:${p.min}:${p.s} ET`;
  };
  tick();
  setInterval(tick, 1000);
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".copy-btn");
  if (btn) {
    const val = btn.getAttribute("data-copy");
    const done = () => {
      btn.classList.add("ok");
      const orig = btn.textContent;
      btn.textContent = "COPIED";
      setTimeout(() => { btn.classList.remove("ok"); btn.textContent = orig; }, 1200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(val).then(done).catch(() => {});
    } else {
      const ta = document.createElement("textarea");
      ta.value = val;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch {}
      document.body.removeChild(ta);
    }
    return;
  }
  // banner retry: re-run the live RPC tier
  if (e.target.closest("#retry-live")) {
    attemptLive();
    return;
  }
  // view tabs
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    const name = tab.getAttribute("data-tab");
    document.querySelectorAll(".tab").forEach((b) => {
      const on = b === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".tabpanel").forEach((p) => {
      p.hidden = p.id !== "panel-" + name;
    });
    return;
  }
  // feed filter chips
  const chip = e.target.closest("[data-feed-filter]");
  if (chip) {
    feedFilter = chip.getAttribute("data-feed-filter");
    if (feedCtx) renderFeed(feedCtx);
    return;
  }
  // collapsible feed groups
  const ghead = e.target.closest(".group-head");
  if (ghead) {
    const g = ghead.closest(".feed-group");
    const open = g.classList.toggle("open");
    ghead.setAttribute("aria-expanded", open ? "true" : "false");
    return;
  }
  // collapsible agent cards
  const head = e.target.closest(".agent-head");
  if (head) {
    const card = head.closest(".agent-card");
    const open = card.classList.toggle("open");
    head.setAttribute("aria-expanded", open ? "true" : "false");
  }
});

// keyboard support for collapsible cards and feed groups
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && (e.target.classList?.contains("agent-head") || e.target.classList?.contains("group-head"))) {
    e.preventDefault();
    e.target.click();
  }
});

/* ───────────────────────── boot ───────────────────────── */

/* Boot context, kept global so the banner's RETRY LIVE button can re-run the live tier. */
let bootCtx = null;

async function boot() {
  startClock();

  let snap;
  try {
    snap = await fetchJson("data.snapshot.json");
  } catch (e) {
    document.querySelectorAll(".loading").forEach((el) => {
      el.textContent = "data unavailable — data.snapshot.json could not be loaded.";
    });
    return;
  }

  // Implied SPCX price from the treasury's own acquisition: $12 → 0.077702 SPCX.
  // Cross-checks against vesting rows (5.88 / 0.038077 ≈ same).
  // This is the initial mark; the live Jupiter quote replaces it when the feed is up.
  const s0 = (snap.vesting?.schedules ?? [])[0];
  const spcxImplied = s0 ? Number(s0.principalUsd) / Number(s0.principalAmount) : 154.44;

  // Agent labels from the repo registry when reachable (not on Pages) — else the id.
  const agentsReg = await optional(fetchJson("../data/agents.json"));
  const agentLabels = {};
  for (const a of agentsReg?.agents ?? []) agentLabels[a.id] = a.label;

  // Map payout-tx → blockTime for earnings "paid" timestamps.
  const sigTs = {};
  for (const v of Object.values(snap.vaults ?? {})) {
    for (const s of v.recentSigs ?? []) {
      if (s?.signature && s.blockTime) sigTs[s.signature] = s.blockTime;
    }
  }

  const ctx = {
    mode: "connecting",
    ts: snap.snapshotTs,
    snapshot: snap,
    vaults: snap.vaults ?? {},
    bounties: snap.bounties ?? [],
    vesting: snap.vesting?.schedules ?? [],
    policySha: snap.policy?.sha256 ?? null,
    agentLabels,
    spcxImplied,
    spcxMark: spcxImplied, // valuation mark: broker-ref until the live quote lands
    priceSource: "ref",
    sigTs,
  };
  bootCtx = ctx;

  // Render the committed snapshot immediately — the page is never blank —
  // then upgrade to live in the background.
  setMode("connecting");
  renderTapes(ctx);
  renderOverview(ctx);
  renderAgents(ctx);
  renderFeed(ctx);
  renderBounties(ctx);

  // Live quote feed (independent of RPC tier): upgrades the SPCX mark + stocks tape.
  refreshLiveQuotes(ctx);
  setInterval(() => refreshLiveQuotes(ctx), 60_000);

  // Tier 1: live RPC. attemptLive() re-renders everything on completion.
  attemptLive();
}

document.addEventListener("DOMContentLoaded", boot);
