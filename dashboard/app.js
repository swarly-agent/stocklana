/*
 * STOCKLANA TERMINAL — dependency-free, zero build step.
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

/* ───────────────────────── data boot ───────────────────────── */

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(path + ": http " + res.status);
  return res.json();
}
async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(path + ": http " + res.status);
  return res.text();
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

function renderTape(ctx) {
  const t = ctx.vaults.treasury ?? {};
  const a1 = ctx.vaults.agent1 ?? {};
  const tUsdc = tokenBalance(t, USDC_MINT);
  const tSpcx = tokenBalance(t, SPCX_MINT);
  const a1Spcx = tokenBalance(a1, SPCX_MINT);
  const paid = ctx.bounties.filter((b) => b.status === "paid");
  const paidUsd = paid.reduce((s, b) => s + (b.payout?.usdc ?? 0) + (b.payout?.spcxVesting ?? 0), 0);
  const items = [
    `<span class="k">SPCX</span> <span class="up">${fmtUsd(ctx.spcxImplied, 2)}</span> <span class="k">IMPLIED</span>`,
    `<span class="k">TREASURY</span> ${fmtTok(tUsdc, 2)} <span class="k">USDC</span>`,
    `<span class="k">TREASURY</span> ${fmtTok(tSpcx)} <span class="k">SPCX</span>`,
    `<span class="k">AGENT-1</span> ${fmtTok(a1Spcx)} <span class="k">SPCX</span>`,
    `<span class="k">BOUNTIES</span> <span class="up">${paid.length}/${ctx.bounties.length} PAID</span>`,
    `<span class="k">PAID OUT</span> <span class="up">${fmtUsd(paidUsd)}</span>`,
    `<span class="k">VESTING</span> ${ctx.vesting.length} ACTIVE <span class="k">· 90D LIN / 7D CLIFF</span>`,
    `<span class="k">POLICY</span> 70/30 <span class="k">· +10% MATCH · −2% FEE</span>`,
  ];
  const half = items.map((i) => `<span class="tape-item">${i}<span class="sep">///</span></span>`).join("");
  $("tape-track").innerHTML = half + half; // duplicated for seamless loop
}

function renderTreasury(ctx) {
  const t = ctx.vaults.treasury;
  if (!t) { $("treasury-body").innerHTML = `<p class="loading">treasury vault not found.</p>`; return; }
  const usdc = tokenBalance(t, USDC_MINT);
  const spcx = tokenBalance(t, SPCX_MINT);
  const approxUsd = usdc + spcx * ctx.spcxImplied;
  $("treasury-meta").textContent = "1-of-2 squads · threshold 1";

  const rows = (t.tokens ?? [])
    .filter((x) => MINT_LABELS[x.mint])
    .map((x) => `<tr><td><strong>${esc(tokenLabel(x.mint))}</strong></td>
      <td class="num">${fmtTok(x.uiAmount)}</td>
      <td class="muted">${esc(x.program)}</td>
      <td>${addrCell(x.mint)}</td></tr>`).join("");

  $("treasury-body").innerHTML = `
    <div class="stat-grid">
      <div class="stat"><span class="k">USDC</span><span class="v green">${fmtTok(usdc, 2)}</span></div>
      <div class="stat"><span class="k">SPCX</span><span class="v amber">${fmtTok(spcx)}</span></div>
      <div class="stat"><span class="k">SOL</span><span class="v">${fmtTok(t.sol, 4)}</span></div>
      <div class="stat"><span class="k">USDC+SPCX ≈ USD (ex SOL)</span><span class="v">${fmtUsd(approxUsd)}</span></div>
    </div>
    <table class="term"><thead><tr><th>ASSET</th><th class="num">BALANCE</th><th>PROGRAM</th><th>MINT</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4" class="muted">no token accounts</td></tr>`}</tbody></table>
    <table class="term" style="margin-top:8px"><thead><tr><th>ROLE</th><th>ADDRESS</th></tr></thead><tbody>
      <tr><td class="muted">VAULT PDA</td><td>${addrCell(t.vaultPda)}</td></tr>
      <tr><td class="muted">MULTISIG</td><td>${addrCell(t.multisigPda)}</td></tr>
      <tr><td class="muted">USDC ATA</td><td>${addrCell(TREASURY_USDC_ATA)}</td></tr>
      <tr><td class="muted">SPCX ATA</td><td>${addrCell(TREASURY_SPCX_ATA)}</td></tr>
    </tbody></table>`;
}

function renderPolicy(ctx) {
  const R = 54, C = 2 * Math.PI * R;
  const seg = (frac, offset, color) =>
    `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${color}" stroke-width="18"
      stroke-dasharray="${(frac * C).toFixed(1)} ${C.toFixed(1)}"
      stroke-dashoffset="${(-offset * C).toFixed(1)}"
      transform="rotate(-90 70 70)" />`;
  $("policy-body").innerHTML = `
    <div class="donut-wrap">
      <svg class="donut" width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="70 percent liquid USDC, 30 percent vested SPCX">
        <circle cx="70" cy="70" r="${R}" fill="none" stroke="#1c1c20" stroke-width="18" />
        ${seg(0.70, 0, "#2fd98a")}${seg(0.30, 0.70, "#ffa028")}
        <text x="70" y="66" text-anchor="middle" fill="#fff" font-size="17" font-weight="700" font-family="inherit">NET</text>
        <text x="70" y="84" text-anchor="middle" fill="#8b8b94" font-size="10" font-family="inherit">100%</text>
      </svg>
      <div class="donut-legend">
        <div class="legend-row"><span class="swatch" style="background:#2fd98a"></span>LIQUID USDC<span class="pc" style="color:var(--green)">70%</span></div>
        <div class="legend-row"><span class="swatch" style="background:#ffa028"></span>VESTED SPCX<span class="pc" style="color:var(--amber)">30%</span></div>
        <div class="legend-row"><span class="swatch" style="background:#5aa9ff"></span>EMPLOYER MATCH<span class="pc">+10%</span></div>
        <div class="legend-row"><span class="swatch" style="background:#ff5252"></span>PROTOCOL FEE<span class="pc" style="color:var(--red)">−2%</span></div>
      </div>
    </div>
    <div class="fee-note">
      Every bounty pays <strong>70% liquid USDC</strong> + <strong>30% SPCX vested</strong> (90-day linear, 7-day cliff),
      plus a <strong>10% employer match</strong> on the vested slice in SPCX. The protocol takes <strong>2%</strong> of the
      bounty at payout — never on swaps or transfers.<br>
      <span class="dim">Enforced by 05-allocate.ts policy validation · </span>
      <a href="${POLICY_URL}" target="_blank" rel="noopener">allocation-policy-v1.md</a>
      ${ctx.policySha ? `<br><span class="dim">sha256 </span><code>${esc(ctx.policySha.slice(0, 16))}…</code>` : ""}
    </div>`;
}

function renderAgents(ctx) {
  const now = Math.floor(Date.now() / 1000);
  const order = ["agent1", "agent2"];
  const labels = { agent1: ctx.agentLabels["agent-1"], agent2: ctx.agentLabels["agent-2"] };
  $("agents-meta").textContent = order.filter((k) => ctx.vaults[k]).length + " squads vaults";

  $("agents-body").innerHTML = order.map((key, i) => {
    const v = ctx.vaults[key];
    if (!v) return "";
    const id = key === "agent1" ? "agent-1" : "agent-2";
    const usdc = tokenBalance(v, USDC_MINT);
    const spcx = tokenBalance(v, SPCX_MINT);
    const scheds = ctx.vesting.filter((s) => s.agent === id);
    const schedHtml = scheds.map((s) => {
      const frac = vestedFraction(s, now);
      const total = Number(s.principalAmount) + Number(s.matchAmount);
      const vested = total * frac;
      return `<div class="vest-row">
        <div class="vest-top"><span class="vest-id">${esc(s.id)}</span>
        <span class="muted">${fmtTok(vested)} / ${fmtTok(total)} SPCX · ${fmtPct(frac)} vested</span></div>
        <div class="timeline"><div class="vested" style="width:${(frac * 100).toFixed(2)}%"></div>
        <div class="cliff" style="left:${(Number(s.cliffDays) / Number(s.durationDays) * 100).toFixed(2)}%"></div></div>
      </div>`;
    }).join("");
    return `<div class="agent-card">
      <div class="agent-head">
        <span class="agent-id">AGENT-${i + 1}</span>
        <span class="agent-label">${esc(labels[key] ?? id)}</span>
        <span class="p-meta">vault ${addrCell(v.vaultPda)}</span>
      </div>
      <div class="agent-bal">
        <div><span class="k">LIQUID USDC</span><span class="v" style="color:var(--green)">${fmtTok(usdc, 2)}</span></div>
        <div><span class="k">SPCX HELD</span><span class="v" style="color:var(--amber)">${fmtTok(spcx)}</span></div>
        <div><span class="k">SOL (RENT)</span><span class="v">${fmtTok(v.sol, 4)}</span></div>
        <div><span class="k">VESTING</span><span class="v">${scheds.length} schedule${scheds.length === 1 ? "" : "s"}</span></div>
      </div>
      ${schedHtml ? `<div style="padding:0 10px 10px">${schedHtml}</div>` : ""}
    </div>`;
  }).join("");
}

function renderVesting(ctx) {
  const now = Math.floor(Date.now() / 1000);
  if (!ctx.vesting.length) { $("vesting-body").innerHTML = `<p class="loading">no vesting schedules yet.</p>`; return; }
  $("vesting-body").innerHTML = ctx.vesting.map((s) => {
    const start = Number(s.startTs);
    const cliffTs = start + Number(s.cliffDays) * 86400;
    const end = start + Number(s.durationDays) * 86400;
    const frac = vestedFraction(s, now);
    const total = Number(s.principalAmount) + Number(s.matchAmount);
    const vested = total * frac;
    const elapsedPct = Math.min(100, Math.max(0, (now - start) / (end - start) * 100));
    const cliffPct = (Number(s.cliffDays) / Number(s.durationDays) * 100);
    const state = now < cliffTs
      ? `<span style="color:var(--red)">IN CLIFF</span> — first release in ${((cliffTs - now) / 86400).toFixed(1)}d`
      : frac >= 1 ? `<span style="color:var(--green)">FULLY VESTED</span>` : `<span style="color:var(--blue)">VESTING</span>`;
    return `<div class="vest-row">
      <div class="vest-top">
        <span><span class="vest-id">${esc(s.id)}</span> <span class="pill active">${esc(s.status).toUpperCase()}</span></span>
        <span class="muted">${esc(s.agent)}</span>
      </div>
      <div class="timeline">
        <div class="elapsed" style="width:${elapsedPct.toFixed(2)}%"></div>
        <div class="vested" style="width:${(frac * 100).toFixed(2)}%"></div>
        <div class="cliff" style="left:${cliffPct.toFixed(2)}%"></div>
        <div class="end-cap"></div>
      </div>
      <div class="ticks"><span>DAY 0 · ${utc(start)}</span><span>CLIFF · DAY ${s.cliffDays}</span><span>DAY ${s.durationDays} · ${utc(end)}</span></div>
      <div class="vest-meta">
        ${state} · vested <strong style="color:var(--text)">${fmtTok(vested)} / ${fmtTok(total)} SPCX</strong> (${fmtPct(frac)})<br>
        principal ${fmtTok(s.principalAmount)} SPCX (${fmtUsd(s.principalUsd)}) + match ${fmtTok(s.matchAmount)} SPCX (${fmtUsd(s.matchUsd)})<br>
        fund ${txLink(s.fundingTx)} · match ${txLink(s.matchTx)}<br>
        <span class="dim">enforcement: ${esc(s.enforcement ?? "ledger-manual — disclosed, not a program")}</span>
      </div>
    </div>`;
  }).join("");
}

function renderBounties(ctx) {
  const paid = ctx.bounties.filter((b) => b.status === "paid").length;
  $("bounties-meta").textContent = `${paid}/${ctx.bounties.length} paid · verifier: Sting`;
  $("bounties-body").innerHTML = `
    <table class="term"><thead><tr>
      <th>ID</th><th>BOUNTY</th><th class="num">PAYOUT</th><th>STATUS</th><th>CLAIM</th>
    </tr></thead><tbody>
    ${ctx.bounties.map((b) => {
      const p = b.payout ?? {};
      const status = String(b.status).toLowerCase() === "paid"
        ? `<span class="pill paid">PAID</span>`
        : `<span class="pill open">OPEN</span>`;
      const payout = `<span style="color:var(--green)">${fmtUsd(p.usdc)} USDC</span><br>` +
        `<span style="color:var(--amber)">${fmtUsd(p.spcxVesting)} SPCX</span> <span class="dim">vested</span><br>` +
        `<span class="dim small">+${((p.matchBps ?? 0) / 100).toFixed(0)}% match · −${((p.feeBps ?? 0) / 100).toFixed(0)}% fee</span>`;
      const claim = b.status === "paid"
        ? `<span class="muted small">${esc(b.claimant ?? "")}</span><br>${txLink(b.payoutTx)}<br>` +
          (b.evidenceUrl ? `<a href="${esc(b.evidenceUrl)}" target="_blank" rel="noopener" class="small">evidence ↗</a>` : "")
        : `<div class="claim-box">${esc(b.howToClaim ?? "")}<br><br>` +
          `<a href="${REPO_URL}" target="_blank" rel="noopener">OPEN A PR ↗</a> <span class="dim">— first merged wins</span></div>`;
      return `<tr>
        <td><code>${esc(b.id)}</code></td>
        <td><strong>${esc(b.title)}</strong><br><span class="muted small">${esc(b.acceptanceCriteria ?? "")}</span>
          ${b.note ? `<br><span class="dim small">◈ ${esc(b.note)}</span>` : ""}</td>
        <td class="num">${payout}</td>
        <td>${status}</td>
        <td>${claim}</td>
      </tr>`;
    }).join("")}
    </tbody></table>`;
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

function renderTxlog(ctx) {
  const seen = new Map();
  for (const v of Object.values(ctx.vaults)) {
    for (const s of v.recentSigs ?? []) {
      if (s?.signature && !seen.has(s.signature)) seen.set(s.signature, s);
    }
  }
  const sigs = [...seen.values()].sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0)).slice(0, 14);
  if (!sigs.length) { $("txlog-body").innerHTML = `<p class="loading">no transactions yet.</p>`; return; }
  $("txlog-body").innerHTML = sigs.map((s) => {
    const info = txLabelFor(s.signature, ctx);
    return `<div class="tx-row">
      <span class="tx-type ${info.type}">${info.type ? info.type.toUpperCase() : "TX"}</span>
      <span class="tx-label">${esc(info.label)}</span>
      <span class="tx-sig">${txLink(s.signature)}</span>
      <span class="tx-time">${s.blockTime ? utc(s.blockTime) + " UTC" : "—"}</span>
    </div>`;
  }).join("");
}

function renderDisclosures() {
  fetchText("disclosures.md").then((md) => {
    const sections = md.split(/^## /m).slice(1);
    $("disclosures-body").innerHTML = sections.map((sec) => {
      const nl = sec.indexOf("\n");
      const title = sec.slice(0, nl).trim();
      const body = sec.slice(nl + 1).trim()
        .split(/\n\n+/).map((p) => `<p>${esc(p).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, " ")}</p>`).join("");
      const m = title.match(/^(\d+)\.\s*(.*)$/);
      return `<div class="disc"><span class="disc-n">${m ? m[1] : "•"}</span><div><strong>${esc(m ? m[2] : title)}</strong>${body}</div></div>`;
    }).join("");
  }).catch(() => {
    $("disclosures-body").innerHTML = `<p class="loading">disclosures.md not found.</p>`;
  });
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
  if (!btn) return;
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

  const ctx = {
    mode: "snapshot",
    ts: snap.snapshotTs,
    vaults: snap.vaults ?? {},
    bounties: snap.bounties ?? [],
    vesting: snap.vesting?.schedules ?? [],
    policySha: snap.policy?.sha256 ?? null,
    agentLabels,
    spcxImplied,
  };

  // Tier 1: probe live RPC against the treasury vault.
  try {
    const probe = ctx.vaults.treasury?.vaultPda;
    if (!probe) throw new Error("no treasury vault in snapshot");
    await live.balance(probe);
    ctx.vaults = await loadLiveVaults(snap);
    ctx.mode = "live";
    ctx.ts = Math.floor(Date.now() / 1000);
  } catch {
    ctx.mode = "snapshot"; // banner shows committed snapshot ts
  }

  setMode(ctx.mode, ctx.ts);
  renderTape(ctx);
  renderTreasury(ctx);
  renderPolicy(ctx);
  renderAgents(ctx);
  renderVesting(ctx);
  renderBounties(ctx);
  renderTxlog(ctx);
  renderDisclosures();
}

document.addEventListener("DOMContentLoaded", boot);
