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
 *     snapshot (stable), balances/tokens/signatures read live.
 *   Tier 2 (fallback): committed data.snapshot.json rendered with a visible
 *     "SNAPSHOT MODE" banner. The demo never shows a blank screen.
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
    { label: "AGENT-1 ALLOCATION · $5 USDC → 0.095208 SPCX", type: "alloc" },
};
// USD volume attributed to known swap transactions (verified session records).
const TX_USD_VOLUME = {
  "5TQ2Cbr3tGFMhg4vqKBiKaK8J3whufyHBtpzmNfiMrgDyqeMs7d94FiN1TZLdxagiunhivsr5y8GzK7HTJCWgV1N": 12,
  "4u8yp6S8bDUePJz2agQrNoqjpcNzAAnf5kmHLeurNQRePnyHLWECYyrWpNkfa67ZkagVXKZ41zyNP81jWtRAB6XZ": 5,
};

const REPO_URL = "https://github.com/swarly-agent/stocklana";
const POLICY_URL = REPO_URL + "/blob/main/policy/allocation-policy-v1.md";

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
const utc = (ts) => {
  const d = new Date(ts * 1000);
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};
const utcFull = (ts) => new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19);

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

async function loadLiveVaults(snap) {
  const vaults = {};
  for (const [name, v] of Object.entries(snap.vaults ?? {})) {
    if (!v?.vaultPda) continue;
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
  }
  return vaults;
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

function setMode(mode, ts) {
  const dot = $("net-dot");
  const badge = $("mode-badge");
  const text = $("mode-text");
  if (mode === "live") {
    dot.className = "dot live";
    badge.querySelector(".dot").className = "dot live";
    text.textContent = "LIVE";
    text.style.color = "var(--green)";
  } else {
    dot.className = "dot snap";
    badge.querySelector(".dot").className = "dot snap";
    text.textContent = "SNAPSHOT";
    text.style.color = "var(--amber)";
    $("snap-banner").hidden = false;
    $("snap-ts").textContent = utcFull(ts);
  }
}

function totals(ctx) {
  const t = ctx.vaults.treasury ?? {};
  const agents = ["agent1", "agent2"].map((k) => ctx.vaults[k]).filter(Boolean);
  const usdc = tokenBalance(t, USDC_MINT) + agents.reduce((s, v) => s + tokenBalance(v, USDC_MINT), 0);
  const spcx = tokenBalance(t, SPCX_MINT) + agents.reduce((s, v) => s + tokenBalance(v, SPCX_MINT), 0);
  const sol = (t.sol ?? 0) + agents.reduce((s, v) => s + (v.sol ?? 0), 0);
  return { usdc, spcx, sol, usd: usdc + spcx * ctx.spcxImplied };
}

function renderTape(ctx) {
  const tot = totals(ctx);
  const paid = ctx.bounties.filter((b) => b.status === "paid");
  const paidUsd = paid.reduce((s, b) => s + bountyUsd(b), 0);
  const open = ctx.bounties.filter((b) => String(b.status).toLowerCase() !== "paid");
  const vol = swapVolume24h(ctx);
  const items = [
    `<span class="k">SPCX</span> <span class="up">${fmtUsd(ctx.spcxImplied, 2)}</span> <span class="k">IMPLIED</span>`,
    `<span class="k">TOTAL AUM</span> <span class="up">${fmtUsd(tot.usd)}</span>`,
    `<span class="k">ACCOUNTS</span> ${["agent1", "agent2"].filter((k) => ctx.vaults[k]).length} <span class="k">AGENTS</span>`,
    `<span class="k">24H VOL</span> <span class="up">${fmtUsd(vol.usd)}</span> <span class="k">· ${vol.n} SWAPS</span>`,
    `<span class="k">BOUNTIES</span> <span class="up">${paid.length}/${ctx.bounties.length} PAID</span>`,
    `<span class="k">OPEN</span> ${open.length} <span class="k">·</span> <span class="up">${fmtUsd(paidUsd)}</span> <span class="k">PAID OUT</span>`,
    `<span class="k">VESTING</span> ${ctx.vesting.length} ACTIVE <span class="k">· 90D LIN / 7D CLIFF</span>`,
    `<span class="k">POLICY</span> 70/30 <span class="k">· +10% MATCH · −2% FEE</span>`,
  ];
  const half = items.map((i) => `<span class="tape-item">${i}<span class="sep">///</span></span>`).join("");
  $("tape-track").innerHTML = half + half; // duplicated for seamless loop
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
      <div class="row"><span>AGENT-1</span><span class="num">${fmtTok(a1Spcx)} SPCX · ${fmtUsd(vaultUsd(a1, ctx.spcxImplied))}</span></div>
      <div class="row"><span>POLICY</span><span class="num">70/30 · +10% match · −2% fee</span></div>
      <div class="row"><span class="dim">ex SOL (rent/fees)</span><span class="num dim">${fmtTok(tot.sol, 4)} SOL</span></div>
    </div>`;

  // Asset mix
  const usdcUsd = tot.usdc;
  const spcxUsd = tot.spcx * ctx.spcxImplied;
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
      <div class="row"><span>REFERENCE</span><span class="num dim">${utc(ctx.ts)} UTC</span></div>
    </div>`;

  // Accounts
  const agents = ["agent1", "agent2"].filter((k) => ctx.vaults[k]);
  const activeVest = ctx.vesting.filter((s) => String(s.status).toLowerCase() === "active").length;
  $("ov-accounts").innerHTML = `
    <span class="ov-k">ACCOUNTS</span>
    <div class="ov-v">${agents.length} <span style="font-size:13px;font-weight:400;color:var(--muted)">AGENTS</span></div>
    <div class="ov-sub">
      <div class="row"><span>AGENT-1</span><span class="num" style="color:var(--green)">ACTIVE · ${fmtUsd(vaultUsd(ctx.vaults.agent1 ?? {}, ctx.spcxImplied))}</span></div>
      <div class="row"><span>AGENT-2</span><span class="num dim">NEW · ${fmtUsd(vaultUsd(ctx.vaults.agent2 ?? {}, ctx.spcxImplied))}</span></div>
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
    <div class="ticks"><span>DAY 0 · ${utc(start)}</span><span>CLIFF · DAY ${s.cliffDays}</span><span>DAY ${s.durationDays} · ${utc(end)}</span></div>
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
    const acctUsd = vaultUsd(v, ctx.spcxImplied);
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
            <span class="muted small">paid ${paidTs ? utc(paidTs) + " UTC" : "—"}</span></span>
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

function renderFeed(ctx) {
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
    });
  }

  for (const b of ctx.bounties) {
    if (!b.postedTs) continue;
    events.push({
      ts: b.postedTs,
      type: "bounty",
      body: `BOUNTY POSTED · ${b.id.toUpperCase()} — ${esc(b.title)} (${fmtUsd(bountyUsd(b))})`,
      sig: null,
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
    events.push({ ts: now, type: "vest", body: txt, sig: null, live: true });
  }

  events.sort((a, b) => b.ts - a.ts);
  const list = events.slice(0, 18);
  $("feed-meta").textContent = `${events.length} events · newest first`;

  $("feed-body").innerHTML = list.length
    ? `<div class="feed">${list.map((e) => `
        <div class="feed-item">
          <span class="feed-ts">${utc(e.ts)}${e.live ? " ·" : ""}</span>
          <span class="feed-type ${e.type}">${FEED_ICONS[e.type] ?? ""} ${e.type.toUpperCase()}</span>
          <span class="feed-body">${e.body}${e.sig ? `<span class="sig">${txLink(e.sig)}</span>` : ""}</span>
        </div>`).join("")}</div>`
    : `<p class="loading">no activity yet.</p>`;
}

/* ── F4 · bounty board ── */

function renderBounties(ctx) {
  const paid = ctx.bounties.filter((b) => String(b.status).toLowerCase() === "paid");
  const open = ctx.bounties.filter((b) => String(b.status).toLowerCase() !== "paid");
  $("bounties-meta").textContent = `${paid.length}/${ctx.bounties.length} paid · verifier: Sting`;

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
  const el = $("utc-clock");
  const tick = () => {
    const d = new Date();
    const p = (x) => String(x).padStart(2, "0");
    el.textContent = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
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
  // collapsible agent cards
  const head = e.target.closest(".agent-head");
  if (head) {
    const card = head.closest(".agent-card");
    const open = card.classList.toggle("open");
    head.setAttribute("aria-expanded", open ? "true" : "false");
  }
});

// keyboard support for collapsible cards
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.classList?.contains("agent-head")) {
    e.preventDefault();
    e.target.click();
  }
});

/* ───────────────────────── boot ───────────────────────── */

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
    mode: "snapshot",
    ts: snap.snapshotTs,
    vaults: snap.vaults ?? {},
    bounties: snap.bounties ?? [],
    vesting: snap.vesting?.schedules ?? [],
    policySha: snap.policy?.sha256 ?? null,
    agentLabels,
    spcxImplied,
    sigTs,
  };

  // Tier 1: probe live RPC against the treasury vault.
  try {
    const probe = ctx.vaults.treasury?.vaultPda;
    if (!probe) throw new Error("no treasury vault in snapshot");
    await live.balance(probe);
    ctx.vaults = await loadLiveVaults(snap);
    ctx.mode = "live";
    ctx.ts = Math.floor(Date.now() / 1000);
    // refresh sig timestamps from live data
    for (const v of Object.values(ctx.vaults)) {
      for (const s of v.recentSigs ?? []) {
        if (s?.signature && s.blockTime) ctx.sigTs[s.signature] = s.blockTime;
      }
    }
  } catch {
    ctx.mode = "snapshot"; // banner shows committed snapshot ts
  }

  setMode(ctx.mode, ctx.ts);
  renderTape(ctx);
  renderOverview(ctx);
  renderAgents(ctx);
  renderFeed(ctx);
  renderBounties(ctx);
}

document.addEventListener("DOMContentLoaded", boot);
