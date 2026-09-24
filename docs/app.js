/*
 * MUSEX TERMINAL — dependency-free, zero build step.
 *
 * DATA POLICY: read-only. This file NEVER contains, requests, or transmits
 * any API key, secret, or private key. Live reads go through our edge proxy
 * (stocklana-rpc), which injects the API key server-side — the browser never
 * sees or transmits it. Keyless public RPC endpoints remain as fallback only.
 * NO API KEY IN BROWSER CODE — EVER.
 *
 * Snapshot model (no streaming): balances refresh every 60s from our Solana
 * RPC proxy (keyless public endpoints as fallback); stock quotes refresh
 * every 60s from Jupiter's price API.
 * Every number on screen carries the timestamp of the snapshot it came
 * from — the header badge reads "AS OF HH:MM:SS ET", green when fresh,
 * amber when stale. A failed refresh keeps the last good numbers, shows
 * a banner naming the last-good time, and retries on the next 60s tick.
 * Vault reads are staggered (not one parallel burst) so neither the proxy
 * nor the fallback RPCs rate-limit us; background-tab foregrounding does
 * one quiet refresh instead of letting stacked timers burst.
 *
 * Live stock quotes: Jupiter's public price API (no key, CORS-open), one
 * batch call for all Backpack Securities mints, refreshed every 60s. Baked
 * underlying-equity refs are fallback only. The SPCX valuation mark follows
 * the live quote so the AUM tape and the stocks tape always agree.
 */

"use strict";

/* ───────────────────────── constants ───────────────────────── */

// Primary: our Cloudflare edge proxy (key injected server-side, allowlisted
// methods, per-IP rate limits). Fallbacks: keyless public endpoints.
const RPC_ENDPOINTS = [
  "https://stocklana-rpc.swarly-agent.workers.dev",
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];
const RPC_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;

const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SPCX_MINT = "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const MINT_LABELS = { [USDC_MINT]: "USDC", [SPCX_MINT]: "SPCX" };

// Treasury token accounts (recorded during mainnet setup, 2026-09-23)
const TREASURY_USDC_ATA = "Bsk1Ei2jEYQT9m6tHU7wjkxdx4mSa3jbyUwBApJ7XPE3";
const TREASURY_SPCX_ATA = "73UVXXtFXFMUGiGsdUWtRwq4Tj241Y4Kx7oJkh7txFXZ";

// Transaction labels live in the snapshot's txRegistry (built by
// 06-snapshot.ts from data/tx-registry.json) — never hardcoded here.
// Only labeled signatures appear on the Activity Wire.

const REPO_URL = "https://github.com/swarly-agent/stocklana";
const POLICY_URL = REPO_URL + "/blob/main/policy/allocation-policy-v2.md";

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

/* Quote-feed auto-retry: 60s healthy cadence; on failure back off
   120s → 240s → 300s (cap) so a struggling feed isn't hammered. */
const quoteAuto = { fails: 0, timer: null, nextAt: 0 };
function quoteDelayMs(fails) {
  if (fails <= 0) return 60_000;
  return Math.min(60_000 * Math.pow(2, Math.min(fails, 3)), 300_000);
}
function scheduleQuoteRefresh(ctx) {
  clearTimeout(quoteAuto.timer);
  const wait = quoteDelayMs(quoteAuto.fails);
  quoteAuto.nextAt = Date.now() + wait;
  quoteAuto.timer = setTimeout(() => { quoteAuto.timer = null; quoteLoop(ctx); }, wait);
}
async function quoteLoop(ctx) {
  await refreshLiveQuotes(ctx); // never throws — failures are counted inside
  scheduleQuoteRefresh(ctx);
}

async function refreshLiveQuotes(ctx) {
  try {
    // SOL rides along in the same batch — its mark feeds AUM, not the stocks tape.
    const r = await fetch(JUP_PRICE_URL + STOCK_QUOTES.map((q) => q.mint).join(",") + "," + SOL_MINT);
    if (!r.ok) throw new Error("http " + r.status);
    const j = await r.json();
    let n = 0;
    for (const q of STOCK_QUOTES) {
      const p = j[q.mint];
      if (p && p.usdPrice) { q.live = { px: p.usdPrice, chgPct: p.priceChange24h ?? 0 }; n++; }
    }
    quotesLiveAt = Date.now(); quotesLiveCount = n; quotesError = "";
    if (n === 0) {
      quoteAuto.fails++;
      quotesError = "empty quote response";
      renderTapes(ctx);
      return;
    }
    quoteAuto.fails = 0;
    if (ctx) {
      let revalued = false;
      // Re-mark AUM to the live SPCX quote so the tapes agree on one price.
      const spcx = STOCK_QUOTES.find((x) => x.sym === "SPCX");
      if (spcx?.live?.px) {
        ctx.spcxMark = spcx.live.px;
        ctx.priceSource = "live";
        revalued = true;
      }
      const solP = j[SOL_MINT];
      if (solP && solP.usdPrice) {
        ctx.solMark = solP.usdPrice;
        ctx.solPriceSource = "live";
        revalued = true;
      }
      if (revalued) {
        renderTapes(ctx);
        renderOverview(ctx);
        if (!quotesUpgraded) { quotesUpgraded = true; renderAgents(ctx); }
      }
    }
  } catch (e) {
    quoteAuto.fails++;
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

/* Balance refresh: flat 60s snapshot cadence. Vaults are read SEQUENTIALLY
   with a small stagger between them — one parallel burst is what earns 429s
   from the proxy or fallback RPCs. On failure the next tick simply retries in 60s;
   no exponential backoff, so a transient blip never parks the UI. The RETRY
   button always forces an immediate attempt. */
const BALANCE_REFRESH_MS = 60_000;
const VAULT_STAGGER_MS = 400;
const rpcAuto = { timer: null, nextAt: 0, inflight: false, lastAttempt: 0 };
function scheduleRpcRefresh() {
  clearTimeout(rpcAuto.timer);
  rpcAuto.nextAt = Date.now() + BALANCE_REFRESH_MS;
  rpcAuto.timer = setTimeout(() => { rpcAuto.timer = null; attemptLive({ auto: true, quiet: true }); }, BALANCE_REFRESH_MS);
}
function refreshSoon(ms = 2000) {
  // one quiet refresh (tab foregrounding, manual retry) — resets the cadence
  clearTimeout(rpcAuto.timer);
  rpcAuto.nextAt = Date.now() + ms;
  rpcAuto.timer = setTimeout(() => { rpcAuto.timer = null; attemptLive({ auto: true, quiet: true }); }, ms);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const etClock = (ms) => { const p = etParts(ms / 1000); return `${p.h}:${p.min}:${p.s}`; };
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

/** USD value of a vault: USDC + SPCX×mark + SOL×mark. SOL counts toward AUM. */
function vaultUsd(vault, ctx) {
  return tokenBalance(vault, USDC_MINT)
    + tokenBalance(vault, SPCX_MINT) * ctx.spcxMark
    + (vault.sol ?? 0) * (ctx.solMark ?? 0);
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
  // Sequential with stagger — NOT Promise.all across vaults. One parallel
  // burst per refresh is what gets the proxy or fallback RPCs to 429 us.
  const entries = Object.entries(snap.vaults ?? {}).filter(([, v]) => v?.vaultPda);
  for (let i = 0; i < entries.length; i++) {
    const [name, v] = entries[i];
    if (i > 0) await sleep(VAULT_STAGGER_MS);
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
  }
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

/** Label for a signature from the snapshot txRegistry. Unlabeled sigs are plain
 *  onchain transactions (the Activity Wire only shows labeled ones). */
function txLabelFor(sig, ctx) {
  const e = (ctx.txRegistry ?? {})[sig];
  if (e) return { label: e.label ?? "ONCHAIN TRANSACTION", type: e.type ?? "" };
  return { label: "ONCHAIN TRANSACTION", type: "" };
}

/** Unvested SPCX across the given active schedules, in USD at the SPCX mark. */
function vestingUsd(schedules, ctx) {
  const now = ctx.ts;
  let spcx = 0;
  for (const s of schedules ?? []) {
    if (String(s.status).toLowerCase() !== "active") continue;
    const total = Number(s.principalAmount) + Number(s.matchAmount);
    spcx += total * (1 - vestedFraction(s, now));
  }
  return spcx * ctx.spcxMark;
}

/** Swap volume per ET day over the trailing 7 days, from the tx registry. */
function swapVolume7d(ctx) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const p = etParts(ctx.ts - i * 86400);
    days.push({ key: `${p.m}-${p.d}`, usd: 0, n: 0 });
  }
  const idx = new Map(days.map((d, i) => [d.key, i]));
  for (const e of Object.values(ctx.txRegistry ?? {})) {
    if (e?.type !== "swap" || !e.ts) continue;
    if (e.ts <= ctx.ts - 7 * 86400) continue;
    const p = etParts(e.ts);
    const d = days[idx.get(`${p.m}-${p.d}`)];
    if (d) { d.usd += Number(e.usdVolume ?? 0); d.n += 1; }
  }
  return days;
}

/* ───────────────────────── renderers ───────────────────────── */

/* Honest data badge: no LIVE/SNAPSHOT theater. The badge always shows WHEN
   the balances were last refreshed; the dot is green when fresh (<2 min),
   amber when stale. The numbers on screen are never newer than their label.
   A failed refresh keeps the last good numbers, names their timestamp in the
   banner, and retries on the next 60s tick. */
function renderDataBadge(ctx) {
  const dot = $("net-dot");
  const badge = $("mode-badge");
  const text = $("mode-text");
  const banner = $("snap-banner");
  const stale = ctx.staleVaults ?? [];
  const vaultN = Object.keys(ctx.vaults ?? {}).length;
  const fresh = ctx.balancesAt > 0 && stale.length === 0 && Date.now() - ctx.balancesAt < 120_000;
  const cls = fresh ? "live" : "snap";
  dot.className = "dot " + cls;
  badge.querySelector(".dot").className = "dot " + cls;
  text.textContent = ctx.balancesAt > 0 ? "AS OF " + etClock(ctx.balancesAt) + " ET" : "CONNECTING";
  text.style.color = fresh ? "var(--green)" : "var(--amber)";
  if (ctx.balancesError && ctx.balancesAt > 0) {
    banner.hidden = false;
    const allStale = vaultN > 0 && stale.length >= vaultN;
    $("snap-text").innerHTML = allStale
      ? `BALANCES STALE — Solana RPC unreachable (${esc(ctx.balancesError)}). ` +
        `Showing last good balances as of <strong>${etClock(ctx.balancesAt)} ET</strong>. Next try shortly.`
      : `PARTIAL REFRESH — ${esc(stale.join(", "))} unreadable, showing their last good figures. ` +
        `Everything else as of <strong>${etClock(ctx.balancesAt)} ET</strong>.`;
    $("retry-live").hidden = false;
  } else if (!(ctx.balancesAt > 0)) {
    banner.hidden = false;
    $("snap-text").innerHTML = `CONNECTING — reading live balances from Solana RPC…`;
    $("retry-live").hidden = true;
  } else {
    banner.hidden = true;
  }
}

/** Re-run the balance refresh (60s cadence, retry button, tab foregrounding).
 *  Vault addresses come from the committed snapshot (stable); a failed vault
 *  falls back to its snapshot rows without tainting the others. */
async function attemptLive(opts = {}) {
  if (!bootCtx || rpcAuto.inflight) return;
  const ctx = bootCtx;
  rpcAuto.inflight = true;
  rpcAuto.lastAttempt = Date.now();
  try {
    const { vaults, degraded } = await loadLiveVaults(ctx.snapshot);
    ctx.vaults = vaults;
    const stale = degraded.map((d) => d.name);
    ctx.staleVaults = stale;
    // The aggregate timestamp only advances when at least one vault actually
    // refreshed — if every vault failed, the numbers on screen are still the
    // last good set and the badge must say so.
    if (stale.length < Object.keys(vaults).length) {
      ctx.balancesAt = Date.now();
      ctx.ts = Math.floor(ctx.balancesAt / 1000);
    }
    for (const v of Object.values(ctx.vaults)) {
      for (const s of v.recentSigs ?? []) {
        if (s?.signature && s.blockTime) ctx.sigTs[s.signature] = s.blockTime;
      }
    }
    ctx.balancesError = degraded.length
      ? degraded.map((d) => `${d.name}: ${d.error}`).join("; ")
      : "";
    if (ctx.balancesError) console.warn("balance refresh degraded:", ctx.balancesError);
  } catch (e) {
    // total failure: keep the last good vaults and their timestamp
    ctx.balancesError = e?.message ?? String(e);
    console.warn("balance refresh failed:", ctx.balancesError);
  } finally {
    rpcAuto.inflight = false;
  }
  scheduleRpcRefresh();
  renderDataBadge(ctx);
  renderTapes(ctx);
  renderOverview(ctx);
  renderAgents(ctx);
  renderFeed(ctx);
}

function totals(ctx) {
  const t = ctx.vaults.treasury ?? {};
  const keys = agentKeys(ctx);
  const agents = keys.map((k) => ctx.vaults[k]).filter(Boolean);
  const usdc = tokenBalance(t, USDC_MINT) + agents.reduce((s, v) => s + tokenBalance(v, USDC_MINT), 0);
  const spcx = tokenBalance(t, SPCX_MINT) + agents.reduce((s, v) => s + tokenBalance(v, SPCX_MINT), 0);
  const sol = (t.sol ?? 0) + agents.reduce((s, v) => s + (v.sol ?? 0), 0);
  const solMark = ctx.solMark ?? 0;
  return { usdc, spcx, sol, usd: usdc + spcx * ctx.spcxMark + sol * solMark };
}

/** Data-driven agent vault keys — treasury excluded. Never hardcoded. */
function agentKeys(ctx) {
  return Object.keys(ctx.vaults ?? {}).filter((k) => k !== "treasury");
}

function renderTapes(ctx) {
  // ── tape 1 · exchange AUM + holdings (no per-agent splits — detail lives in F2) ──
  const tot = totals(ctx);
  const mark = ctx.spcxMark;
  const markSrc = ctx.priceSource === "live" ? "LIVE" : "REF";
  const solMark = ctx.solMark;
  const solSrc = ctx.solPriceSource === "live" ? "LIVE" : (solMark ? "REF" : "—");
  const spcxUsd = tot.spcx * mark;
  const solUsd = tot.sol * (solMark ?? 0);
  const aumItems = [
    `<span class="k">TOTAL AUM</span> <span class="up"><b>${fmtUsd(tot.usd)}</b></span>`,
    `<span class="k">TREASURY</span> <span class="up">${fmtUsd(vaultUsd(ctx.vaults.treasury ?? {}, ctx))}</span>`,
    `<span class="k">USDC</span> ${fmtTok(tot.usdc, 2)} <span class="k">·</span> <span class="up">${fmtUsd(tot.usdc)}</span>`,
    `<span class="k">SPCX</span> ${fmtTok(tot.spcx)} <span class="k">@</span> ${fmtUsd(mark)} <span class="k">${markSrc}</span> <span class="k">·</span> <span class="up">${fmtUsd(spcxUsd)}</span>`,
    `<span class="k">SOL</span> ${fmtTok(tot.sol, 4)} <span class="k">@</span> ${solMark ? fmtUsd(solMark) : "—"} <span class="k">${solSrc}</span> <span class="k">·</span> <span class="up">${fmtUsd(solUsd)}</span>`,
  ];
  const aumHalf = aumItems.map((i) => `<span class="tape-item">${i}<span class="sep">///</span></span>`).join("");
  $("tape-aum").innerHTML = aumHalf + aumHalf; // duplicated for seamless loop

  // ── tape 2 · Backpack Securities universe — live onchain where the feed is up ──
  const liveN = STOCK_QUOTES.filter((q) => q.live).length;
  const totalN = STOCK_QUOTES.length;
  const statusItem = liveN > 0
    ? `<span class="tape-item"><span class="up">● LIVE ${liveN}/${totalN} ONCHAIN · JUPITER · ${etSec(quotesLiveAt / 1000)} ET</span><span class="sep">///</span></span>`
    : `<span class="tape-item"><span class="k">○ REF ONLY · LIVE QUOTES UNREACHABLE${quotesError ? " (" + esc(quotesError) + ")" : ""} · UNDERLYING REF ${esc(STOCK_QUOTES_TS)}<span class="quote-retry-note"></span></span><span class="sep">///</span></span>`;
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
  // same px/sec as the AUM tape: duration scales with content width (AUM keeps the 60s CSS default)
  const aumW = $("tape-aum").scrollWidth / 2 || 1;
  const stkW = $("tape-stocks").scrollWidth / 2 || 1;
  $("tape-stocks").style.animationDuration = `${(60 * stkW / aumW).toFixed(1)}s`;
}

/* ── footer: vault links rendered from the snapshot, never hardcoded ── */

function renderFooterVaults(ctx) {
  const el = $("foot-vaults");
  if (!el) return;
  el.innerHTML = (ctx.agents ?? []).map((a) => {
    const label = String(a.id ?? a.key).toUpperCase();
    const addr = a.vaultPda ?? a.key;
    return `<a href="https://solscan.io/account/${esc(addr)}" target="_blank" rel="noopener">${esc(label)} VAULT</a>`;
  }).join("");
}

/* ── F1 · exchange overview ── */

/** Short uppercase label for an agent vault key, from the snapshot agent list. */
function agentShortLabel(ctx, key) {
  const a = (ctx.agents ?? []).find((x) => x.key === key);
  return String(a?.id ?? key).toUpperCase();
}
function agentByKey(ctx, key) {
  return (ctx.agents ?? []).find((x) => x.key === key) ?? { key, id: key, label: key };
}

/** AUM-over-time SVG from the committed aum-history.json. Honest when empty. */
function aumHistorySvg(ctx) {
  const hist = ctx.aumHistory ?? [];
  if (hist.length === 0) {
    return `<p class="empty-note">AUM history starts accumulating today — check back as snapshots land.</p>`;
  }
  const pts = hist.map((h) => ({
    ts: h.ts,
    usd: (h.usdc ?? 0) + (h.spcx ?? 0) * (h.spcxMark ?? 0) + (h.sol ?? 0) * (h.solMark ?? 0),
  }));
  const W = 260, H = 64, P = 6;
  const vals = pts.map((p) => p.usd);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const xy = pts.map((p, i) => {
    const x = pts.length === 1 ? W / 2 : P + (i / (pts.length - 1)) * (W - 2 * P);
    const y = H - P - ((p.usd - lo) / span) * (H - 2 * P);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg class="aum-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="AUM over time">
      <polyline points="${xy}" fill="none" style="stroke:var(--green)" stroke-width="1.5"/>
    </svg>
    <div class="ov-sub"><div class="row"><span class="dim">${et(pts[0].ts)} → ${et(pts[pts.length - 1].ts)}</span><span class="num dim">${fmtUsd(vals[0])} → ${fmtUsd(vals[vals.length - 1])}</span></div></div>`;
}

function renderOverview(ctx) {
  const tot = totals(ctx);
  const t = ctx.vaults.treasury ?? {};
  const aum = tot.usd;

  // ── total assets: TOTAL AUM → TREASURY → AGENT ACCOUNTS (top 5 + "N more") ──
  const agentRows = agentKeys(ctx)
    .map((k) => ({ key: k, usd: vaultUsd(ctx.vaults[k] ?? {}, ctx) }))
    .sort((a, b) => b.usd - a.usd);
  const tUsd = vaultUsd(t, ctx);
  const topAgents = agentRows.slice(0, 5);
  const moreN = agentRows.length - topAgents.length;
  const pct = (v) => (aum ? (v / aum * 100).toFixed(1) + "%" : "—");
  $("ov-aum").innerHTML = `
    <span class="ov-k">TOTAL ASSETS IN CUSTODY · AUM</span>
    <div class="ov-v">${fmtUsd(aum)}</div>
    <div class="ov-sub">
      <div class="row"><span>TREASURY</span><span class="num">${fmtUsd(tUsd)} <span class="dim">${pct(tUsd)}</span></span></div>
      <div class="row"><span class="dim">AGENT ACCOUNTS</span><span class="num dim">${agentRows.length}</span></div>
      ${topAgents.map((a) => `
      <div class="row"><span>${esc(agentShortLabel(ctx, a.key))}</span><span class="num">${fmtUsd(a.usd)} <span class="dim">${pct(a.usd)}</span></span></div>`).join("")}
      ${moreN > 0 ? `<div class="row"><span class="dim">+ ${moreN} more</span><span class="num dim">see F2</span></div>` : ""}
      <div class="row"><span class="dim">BALANCES AS OF</span><span class="num dim">${ctx.balancesAt > 0 ? etClock(ctx.balancesAt) + " ET" : "—"}</span></div>
    </div>`;

  // ── asset mix: platform totals ──
  const usdcUsd = tot.usdc;
  const spcxUsd = tot.spcx * ctx.spcxMark;
  const solUsd = tot.sol * (ctx.solMark ?? 0);
  const mixTotal = usdcUsd + spcxUsd + solUsd || 1;
  const w = (v, d) => (v / d * 100).toFixed(2) + "%";
  $("ov-mix").innerHTML = `
    <span class="ov-k">ASSET MIX · USD</span>
    <div class="ov-v">${fmtUsd(aum)}</div>
    <div class="mixbar" role="img" aria-label="asset mix">
      <div class="seg-usdc" style="width:${w(usdcUsd, mixTotal)}"></div>
      <div class="seg-spcx" style="width:${w(spcxUsd, mixTotal)}"></div>
      <div class="seg-sol" style="width:${w(solUsd, mixTotal)}"></div>
    </div>
    <div class="mix-legend">
      <span><span class="swatch" style="background:var(--green)"></span>USDC <b>${fmtUsd(usdcUsd)}</b></span>
      <span><span class="swatch" style="background:var(--amber)"></span>SPCX <b>${fmtUsd(spcxUsd)}</b></span>
      <span><span class="swatch" style="background:var(--blue)"></span>SOL <b>${fmtUsd(solUsd)}</b></span>
    </div>`;

  // ── activity: txn headline + 7d swap volume bars + AUM history ──
  const vol7 = swapVolume7d(ctx);
  const volTotal = vol7.reduce((s, d) => s + d.usd, 0);
  const volN = vol7.reduce((s, d) => s + d.n, 0);
  const maxVol = Math.max(1, ...vol7.map((d) => d.usd));
  const bars = vol7.map((d) => `
    <div class="vol-bar" title="${esc(d.key)} · ${fmtUsd(d.usd)} · ${d.n} swap${d.n === 1 ? "" : "s"}">
      <div class="vol-fill" style="height:${(d.usd / maxVol * 100).toFixed(1)}%"></div>
      <span class="vol-day">${esc(d.key.slice(3))}</span>
    </div>`).join("");
  $("ov-activity").innerHTML = `
    <span class="ov-k">ACTIVITY</span>
    <div class="ov-v">${allSigs(ctx).length} <span style="font-size:13px;font-weight:400;color:var(--muted)">TXNS</span></div>
    <div class="ov-sub">
      <div class="row"><span>7D SWAP VOLUME</span><span class="num">${fmtUsd(volTotal)} · ${volN} swaps</span></div>
      <div class="row"><span class="dim">REFERENCE</span><span class="num dim">${et(ctx.ts)} ET</span></div>
    </div>
    <div class="vol-bars">${bars}</div>
    <div class="ov-sub"><div class="row"><span>AUM HISTORY</span><span class="num dim">${(ctx.aumHistory ?? []).length} snapshots</span></div></div>
    ${aumHistorySvg(ctx)}`;

  // ── accounts: count + AUM donut + new this week ──
  const segs = agentRows;
  const segTotal = segs.reduce((s, x) => s + x.usd, 0) || 1;
  const palette = ["#34d399", "#fbbf24", "#60a5fa", "#c084fc", "#f472b6", "#94a3b8"];
  const R = 34, C = 2 * Math.PI * R;
  let acc = 0;
  const circles = segs.slice(0, 12).map((s, i) => {
    const frac = s.usd / segTotal;
    const dash = `${(frac * C).toFixed(2)} ${C.toFixed(2)}`;
    const off = (-acc * C).toFixed(2);
    acc += frac;
    return `<circle cx="45" cy="45" r="${R}" fill="none" stroke="${palette[i % palette.length]}" stroke-width="12" stroke-dasharray="${dash}" stroke-dashoffset="${off}" transform="rotate(-90 45 45)"/>`;
  }).join("");
  const weekAgo = ctx.ts - 7 * 86400;
  const newThisWeek = (ctx.agents ?? []).filter((a) => (a.createdTs ?? 0) >= weekAgo).length;
  $("ov-accounts").innerHTML = `
    <span class="ov-k">ACCOUNTS</span>
    <div class="ov-v">${segs.length} <span style="font-size:13px;font-weight:400;color:var(--muted)">AGENTS</span></div>
    <div class="acct-flex">
      <svg class="donut" viewBox="0 0 90 90" role="img" aria-label="agent accounts by AUM">${circles || `<circle cx="45" cy="45" r="${R}" fill="none" stroke="var(--border)" stroke-width="12"/>`}</svg>
      <div class="ov-sub" style="flex:1">
        ${segs.slice(0, 5).map((s, i) => `
        <div class="row"><span><span class="swatch" style="background:${palette[i % palette.length]}"></span>${esc(agentShortLabel(ctx, s.key))}</span><span class="num">${fmtPct(s.usd / segTotal)}</span></div>`).join("")}
        ${segs.length > 5 ? `<div class="row"><span class="dim">+${segs.length - 5} more</span><span class="num dim">see F2</span></div>` : ""}
        <div class="row"><span>NEW THIS WEEK</span><span class="num" style="color:var(--green)">${newThisWeek}</span></div>
      </div>
    </div>`;
}

/* ── F2 · agent accounts: data-driven, top 100, paginated, searchable ── */

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
      <span class="muted">${s.durationDays}d linear · ${s.cliffDays}d cliff</span>
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
      vesting total ${fmtTok(total)} SPCX · ${fmtUsd(total * ctx.spcxMark)} at mark<br>
      fund ${txLink(s.fundingTx)}<br>
      <span class="dim">enforcement: ${esc(s.enforcement ?? "ledger-manual — disclosed, not a program")}</span>
    </div>
  </div>`;
}

const AGENTS_PAGE_SIZE = 10;
let agentsPage = 0;
let agentsQuery = "";
let agentsCtx = null;

function renderAgents(ctx) {
  agentsCtx = ctx;
  const q = agentsQuery.trim().toLowerCase();
  let list = agentKeys(ctx).map((key) => {
    const meta = agentByKey(ctx, key);
    const v = ctx.vaults[key] ?? {};
    const acctUsd = vaultUsd(v, ctx);
    const vestUsd = vestingUsd((ctx.vesting ?? []).filter((s) => s.agent === meta.id), ctx);
    return { key, meta, v, acctUsd, vestUsd, liqUsd: Math.max(0, acctUsd - vestUsd) };
  });
  list.sort((a, b) => b.acctUsd - a.acctUsd);
  list = list.slice(0, 100); // top 100
  const filtered = q
    ? list.filter((a) =>
        String(a.meta.vaultPda ?? "").toLowerCase().includes(q) ||
        String(a.meta.label ?? "").toLowerCase().includes(q) ||
        String(a.meta.id ?? "").toLowerCase().includes(q))
    : list;
  const pages = Math.max(1, Math.ceil(filtered.length / AGENTS_PAGE_SIZE));
  agentsPage = Math.min(agentsPage, pages - 1);
  const page = filtered.slice(agentsPage * AGENTS_PAGE_SIZE, (agentsPage + 1) * AGENTS_PAGE_SIZE);

  // Preserve expanded cards + search focus across background re-renders.
  const openCards = new Set(
    [...document.querySelectorAll("#agents-body .agent-card.open")].map((c) => c.getAttribute("data-agent"))
  );
  const searchEl = $("agents-search");
  const hadFocus = searchEl && document.activeElement === searchEl;
  const caret = hadFocus ? searchEl.selectionStart : 0;

  $("agents-meta").textContent = `${filtered.length} account${filtered.length === 1 ? "" : "s"} · click to expand`;

  const cards = page.map((a) => {
    const { key, meta, v } = a;
    const usdc = tokenBalance(v, USDC_MINT);
    const scheds = (ctx.vesting ?? []).filter((s) => s.agent === meta.id);
    const isOpen = openCards.has(key);
    const vestHtml = scheds.length
      ? scheds.map((s) => schedHtml(s, ctx)).join("")
      : `<p class="empty-note">no vesting schedules.</p>`;
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

    return `<div class="agent-card${isOpen ? " open" : ""}" data-agent="${esc(key)}">
      <div class="agent-head" role="button" tabindex="0" aria-expanded="${isOpen}">
        <span class="status-dot ${a.acctUsd > 0 ? "on" : "idle"}"></span>
        <span class="agent-id">${esc(agentShortLabel(ctx, key))}</span>
        <span class="agent-label">${esc(meta.label ?? "")}</span>
        <span class="chev">▸</span>
      </div>
      <div class="agent-summary">
        <div class="sum-cell"><span class="k">ACCOUNT VALUE</span><span class="v">${fmtUsd(a.acctUsd)}</span></div>
        <div class="sum-cell"><span class="k">USDC</span><span class="v" style="color:var(--green)">${fmtTok(usdc, 2)}</span></div>
        <div class="sum-cell"><span class="k">LIQUID</span><span class="v">${fmtUsd(a.liqUsd)}</span></div>
      </div>
      <div class="agent-detail">
        <div class="agent-sec">
          <h4>ADDRESSES</h4>
          <table class="addr-table"><tbody>
            <tr><td class="lbl">VAULT PDA</td><td>${addrCell(meta.vaultPda)}</td></tr>
            <tr><td class="lbl">MULTISIG</td><td>${addrCell(meta.multisigPda)}</td></tr>
          </tbody></table>
        </div>
        <div class="agent-sec">
          <h4>VESTING SCHEDULES · ${scheds.length}</h4>
          ${vestHtml}
        </div>
        <div class="agent-sec">
          <h4>ONCHAIN HISTORY</h4>
          ${swapHtml}
        </div>
      </div>
    </div>`;
  }).join("");

  $("agents-body").innerHTML = `
    <div class="agents-toolbar">
      <input id="agents-search" type="search" placeholder="search by vault address…" value="${esc(agentsQuery)}" aria-label="search agent accounts">
      <span class="dim small">${filtered.length} of ${list.length} shown</span>
    </div>
    ${cards || `<p class="empty-note">no agent accounts match.</p>`}
    ${pages > 1 ? `<div class="pager">
      <button class="chip" data-agents-page="prev"${agentsPage === 0 ? " disabled" : ""}>← PREV</button>
      <span class="dim small">page ${agentsPage + 1} of ${pages}</span>
      <button class="chip" data-agents-page="next"${agentsPage >= pages - 1 ? " disabled" : ""}>NEXT →</button>
    </div>` : ""}`;

  const input = $("agents-search");
  if (input?.addEventListener) {
    if (hadFocus) { input.focus(); try { input.setSelectionRange(caret, caret); } catch {} }
    input.addEventListener("input", (e) => {
      agentsQuery = e.target.value;
      agentsPage = 0;
      renderAgents(ctx);
      const el = $("agents-search");
      if (el) {
        el.focus();
        const pos = e.target.selectionStart ?? el.value.length;
        try { el.setSelectionRange(pos, pos); } catch {}
      }
    });
  }
}

/* ── F3 · activity wire: registry-driven, opens with the full-economics test ── */

const FEED_ICONS = { swap: "⇄", payout: "$", vesting: "◐" };

/* ── wire filters + grouping state ── */

const FEED_FILTERS = [
  { id: "all",     label: "ALL" },
  { id: "swaps",   label: "SWAPS",   types: ["swap"] },
  { id: "payouts", label: "PAYOUTS", types: ["payout"] },
  { id: "vesting", label: "VESTING", types: ["vesting"] },
];
let feedFilter = "all";
let feedCtx = null;

function feedItemHtml(e) {
  return `<div class="feed-item">
    <span class="feed-ts">${et(e.ts)}</span>
    <span class="feed-type ${e.type}">${FEED_ICONS[e.type] ?? ""} ${e.type.toUpperCase()}</span>
    <span class="feed-body">${e.body}${e.sig ? `<span class="sig">${txLink(e.sig)}</span>` : ""}</span>
  </div>`;
}

function renderFeed(ctx) {
  feedCtx = ctx;
  // Preserve manually-expanded groups across background re-renders.
  const openGroups = new Set(
    [...document.querySelectorAll("#feed-body .feed-group.open")].map((g) => g.getAttribute("data-group"))
  );

  // The wire opens with the full-economics test: only registry entries at or
  // after wireStartTs are shown. Before that, an honest empty state — old
  // acquisition/allocation/payout/match/bounty history is excluded, and sweep
  // transactions are never registered.
  const events = [];
  if (ctx.wireStartTs) {
    for (const [sig, e] of Object.entries(ctx.txRegistry ?? {})) {
      if (!e?.ts || e.ts < ctx.wireStartTs) continue;
      events.push({
        ts: e.ts,
        type: e.type,
        body: esc(e.label ?? "ONCHAIN TRANSACTION"),
        sig,
        group: "g-" + (e.agent ?? "treasury"),
      });
    }
    events.sort((a, b) => b.ts - a.ts);
  }

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
      const isOpen = expand || openGroups.has(e.group);
      const gkey = e.group.slice(2);
      const title = gkey === "treasury" ? "TREASURY" : agentShortLabel(ctx, gkey);
      html += `<div class="feed-group${isOpen ? " open" : ""}" data-group="${esc(e.group)}">
        <div class="group-head" role="button" tabindex="0" aria-expanded="${isOpen}">
          <span class="chev">▸</span>
          <span class="group-title">${esc(title)}</span>
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

  const emptyNote = !ctx.wireStartTs
    ? `<p class="empty-note">THE WIRE OPENS WITH THE FULL-ECONOMICS TEST — new transactions will appear here as they land onchain.</p>`
    : `<p class="loading">no activity for this filter.</p>`;

  $("feed-meta").textContent = !ctx.wireStartTs
    ? "opens with the full-economics test"
    : (f.id === "all"
        ? `${events.length} events · newest first`
        : `${list.length} of ${events.length} events · ${f.label}`);
  $("feed-body").innerHTML = list.length
    ? `<div class="feed-filters" role="group" aria-label="filter activity">${chips}</div><div class="feed">${html}</div>`
    : `<div class="feed-filters" role="group" aria-label="filter activity">${chips}</div>${emptyNote}`;
}

/* ── F4 · bounty board ── */

function renderBounties(ctx) {
  const paid = ctx.bounties.filter((b) => String(b.status).toLowerCase() === "paid");
  const open = ctx.bounties.filter((b) => String(b.status).toLowerCase() !== "paid");
  $("bounties-meta").textContent = `${paid.length}/${ctx.bounties.length} paid · verifier: program operator`;

  const paidRows = paid.map((b) => {
    const p = b.payout ?? {};
    const matchUsd = (p.spcx ?? p.spcxVesting ?? 0) * ((p.matchBps ?? 0) / 10000);
    return `<tr>
      <td><code>${esc(b.id)}</code></td>
      <td><strong>${esc(b.title)}</strong><br><span class="muted small">${esc(b.acceptanceCriteria ?? "")}</span>
        ${b.note ? `<br><span class="dim small">◈ ${esc(b.note)}</span>` : ""}</td>
      <td class="num"><span style="color:var(--green)">${fmtUsd(p.usdc)} USDC</span><br>
        <span style="color:var(--amber)">${fmtUsd(p.spcx ?? p.spcxVesting ?? 0)} SPCX</span><br>
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
        <span style="color:var(--amber)">${fmtUsd(p.spcx ?? p.spcxVesting ?? 0)} SPCX</span></td>
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
    // header countdown — next to the ET clock, the single place it lives now
    const hn = $("refresh-note");
    if (hn) {
      hn.textContent = (rpcAuto.timer && rpcAuto.nextAt > Date.now())
        ? `next refresh in ${Math.ceil((rpcAuto.nextAt - Date.now()) / 1000)}s`
        : "";
    }
    const qn = document.querySelectorAll(".quote-retry-note");
    if (qn.length) {
      const txt = (quoteAuto.timer && quoteAuto.nextAt > Date.now() && quoteAuto.fails > 0)
        ? ` · retrying in ${Math.ceil((quoteAuto.nextAt - Date.now()) / 1000)}s`
        : "";
      qn.forEach((el) => { el.textContent = txt; });
    }
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
  // banner retry: force an immediate balance refresh, resetting the cadence
  if (e.target.closest("#retry-live")) {
    refreshSoon(250);
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
  // agent pager buttons
  const pg = e.target.closest("[data-agents-page]");
  if (pg) {
    if (!pg.disabled) {
      agentsPage += pg.getAttribute("data-agents-page") === "next" ? 1 : -1;
      if (agentsCtx) renderAgents(agentsCtx);
    }
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
  // (Vesting ledger retired 2026-09-23 — 154.44 is the same historical mark.)
  // This is the initial mark; the live Jupiter quote replaces it when the feed is up.
  const s0 = (snap.vesting?.schedules ?? [])[0];
  const spcxImplied = s0 ? Number(s0.principalUsd) / Number(s0.principalAmount) : 154.44;

  // AUM-over-time history (separate committed file, maintained by 06-snapshot.ts).
  const aumHistory = await optional(fetchJson("aum-history.json"));

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
    ts: snap.snapshotTs,
    balancesAt: (snap.snapshotTs ?? 0) * 1000, // honest until first refresh: the numbers ARE the snapshot
    balancesError: "",
    staleVaults: [],
    snapshot: snap,
    vaults: snap.vaults ?? {},
    bounties: snap.bounties ?? [],
    vesting: snap.vesting?.schedules ?? [],
    agents: snap.agents ?? [],
    txRegistry: snap.txRegistry ?? {},
    wireStartTs: snap.wireStartTs ?? null,
    aumHistory: Array.isArray(aumHistory) ? aumHistory : [],
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
  renderDataBadge(ctx);
  renderTapes(ctx);
  renderOverview(ctx);
  renderAgents(ctx);
  renderFeed(ctx);
  renderBounties(ctx);
  renderFooterVaults(ctx);

  // Live quote feed (independent of RPC tier): immediate fetch, then
  // self-scheduling with backoff — upgrades the SPCX mark + stocks tape.
  quoteLoop(ctx);

  // Tier 1: Solana RPC balances on the 60s snapshot cadence.
  attemptLive();

  // Foregrounding after a background tab: one quiet refresh instead of
  // letting stacked timers burst (mobile browsers throttle timers, and a
  // burst is what earns 429s from keyless public RPCs).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && bootCtx &&
        !rpcAuto.inflight && Date.now() - rpcAuto.lastAttempt > 30_000) {
      refreshSoon(2000);
    }
  });
}

document.addEventListener("DOMContentLoaded", boot);
