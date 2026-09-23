/*
 * Stocklana dashboard — dependency-free, zero build step.
 *
 * DATA POLICY: read-only. This file NEVER contains, requests, or transmits
 * any API key, secret, or private key. Live reads use PUBLIC RPC endpoints
 * only — the same endpoints anyone's browser can hit without a key.
 * NO API KEY IN BROWSER CODE — EVER.
 *
 * Two-tier data layer (build spec §6):
 *   Tier 1 (live): client-side fetch to public RPCs with rotation, 8s
 *     timeout, 60s in-memory cache so demo-day clicks don't 429.
 *   Tier 2 (fallback): committed data.snapshot.json, rendered with a visible
 *     "snapshot as of <ts>" banner. The demo never shows a blank screen.
 *
 * Registry files (fetched relative to this page; present on GitHub Pages):
 *   ../data/vaults.json, ../data/agents.json, ../data/bounties.json,
 *   ../data/vesting-ledger.json, ../policy/allocation-policy-v1.md,
 *   disclosures.md, data.snapshot.json
 */

"use strict";

const RPC_ENDPOINTS = [
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];
const RPC_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;

const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const MINT_LABELS = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb: "SPCX",
  DKNGQFNGQmoBdXSRGKJ8tTu7uPDasw5JDcfMmWniNfow: "DKNG",
  "4MMQY9bwkxxTtsK3W227Q5ABT6yFY8Pmn9Ze7wmAXKY8": "ALLINU",
};
const MINT_DECIMALS = { USDC: 6, SPCX: 6, DKNG: 6, ALLINU: 6 };

// ------------------------------------------------------------------ rpc tier
const cache = new Map(); // key -> { ts, value }

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
      if (!res.ok) throw new Error(`http ${res.status}`);
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
  signaturesForAddress: (address, limit = 10) =>
    rpcCall("getSignaturesForAddress", [address, { limit }]),
  token2022Accounts: (owner) => live.tokenAccountsByOwner(owner, TOKEN_2022_PROGRAM_ID),
  classicTokenAccounts: (owner) => live.tokenAccountsByOwner(owner, TOKEN_PROGRAM_ID),
};

// ------------------------------------------------------------ registry files
async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: http ${res.status}`);
  return res.json();
}
async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: http ${res.status}`);
  return res.text();
}
async function optional(promise) {
  try {
    return await promise;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ helpers
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const shortAddr = (a) => (a && a.length > 12 ? a.slice(0, 4) + "…" + a.slice(-4) : a);
const solscanAccount = (a) => `https://solscan.io/account/${a}`;
const solscanTx = (s) => `https://solscan.io/tx/${s}`;
const addrLink = (a, label) =>
  a ? `<a href="${solscanAccount(a)}" target="_blank" rel="noopener">${esc(label ?? shortAddr(a))}</a>` : "—";
const txLink = (s) =>
  s ? `<a href="${solscanTx(s)}" target="_blank" rel="noopener">${esc(shortAddr(s))}</a>` : "—";
const fmtUsd = (n) =>
  n == null || isNaN(n) ? "—" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
const fmtTok = (n) =>
  n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 6 });

function tokenLabel(mint) {
  return MINT_LABELS[mint] ?? shortAddr(mint);
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

/** Tiny markdown renderer — headings, bold, paragraphs, bullet lists. */
function mdToHtml(md) {
  const lines = md.split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) {
      if (inList) { html += "</ul>"; inList = false; }
      const level = line.match(/^#+/)[0].length;
      html += `<h${Math.min(level + 1, 4)}>${esc(line.replace(/^#+\s*/, ""))}</h${Math.min(level + 1, 4)}>`;
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inlineMd(line.replace(/^\s*[-*]\s+/, ""))}</li>`;
    } else if (line.trim() === "") {
      if (inList) { html += "</ul>"; inList = false; }
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<p>${inlineMd(line)}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html;
}
function inlineMd(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
}

// ------------------------------------------------------------------ sections
function renderTreasury(el, data) {
  const t = data.vaults.treasury;
  if (!t) {
    el.innerHTML = `<p class="loading">Treasury vault not created yet — run <code>npm run create-vaults -- --live</code>.</p>`;
    return;
  }
  const rows = (t.tokens ?? [])
    .map(
      (tok) =>
        `<tr><td>${esc(tokenLabel(tok.mint))}</td><td class="num">${fmtTok(tok.uiAmount)}</td>` +
        `<td>${esc(tok.program)}</td><td>${addrLink(tok.mint)}</td></tr>`
    )
    .join("");
  const sigs = (t.recentSigs ?? [])
    .map(
      (s) =>
        `<tr><td>${txLink(s.signature)}</td><td>${s.blockTime ? new Date(s.blockTime * 1000).toLocaleString() : "—"}</td></tr>`
    )
    .join("");
  el.innerHTML = `
    <div class="stat-row">
      <div class="stat"><span class="stat-label">SOL</span><span class="stat-value">${fmtTok(t.sol)}</span></div>
      <div class="stat"><span class="stat-label">Vault PDA</span><span class="stat-value small">${addrLink(t.vaultPda)}</span></div>
      <div class="stat"><span class="stat-label">Multisig</span><span class="stat-value small">${addrLink(t.multisigPda)}</span></div>
    </div>
    <h3>Holdings</h3>
    <table><thead><tr><th>Asset</th><th class="num">Balance</th><th>Program</th><th>Mint</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4">no token accounts</td></tr>`}</tbody></table>
    <h3>Recent activity</h3>
    <table><thead><tr><th>Signature</th><th>Time</th></tr></thead>
    <tbody>${sigs || `<tr><td colspan="2">none</td></tr>`}</tbody></table>`;
}

function renderYieldEvidence(el) {
  el.innerHTML = `
    <p>Operator-run fee-harvest → DKNG distribution evidence (Sep 17–19, 2026):
    <strong>28,622</strong> DKNG credits across <strong>6,007</strong> distinct wallets,
    ≈ <strong>10,051.73</strong> DKNG distributed. Run by the ALLINU operator's
    withdraw authority — observable onchain, <strong>pausable at any time</strong>.</p>
    <p class="muted">This is evidence that a fee-funded drip rail is <em>possible</em> —
    a demonstration of a funding rail, not a structural guarantee and never pitched as yield.
    Stocklana V1 holds no ALLINU position.</p>`;
}

function renderAgents(el, detailEl, data) {
  const now = Math.floor(Date.now() / 1000);
  if (!data.agents.length) {
    el.innerHTML = `<p class="loading">No agents registered yet.</p>`;
    return;
  }
  el.innerHTML = data.agents
    .map((a, i) => {
      const vault = Object.values(data.vaults).find((v) => v.vaultPda === a.vault);
      const scheds = data.vestingSchedules.filter((s) => s.agent === a.id);
      const cards = scheds
        .map((s) => {
          const frac = vestedFraction(s, now);
          const vested = Number(s.principalAmount) * frac;
          return `<div class="vest-card">
            <div><strong>${esc(s.id)}</strong> — ${esc(tokenLabel(s.mint))} · ${esc(s.status)}</div>
            <div class="progress"><div class="progress-fill" style="width:${(frac * 100).toFixed(1)}%"></div></div>
            <div class="muted small">vested ${fmtTok(vested)} / ${fmtTok(s.principalAmount)} principal
            + ${fmtTok(s.matchAmount)} match · cliff ${s.cliffDays}d · ${s.durationDays}d linear ·
            funding ${txLink(s.fundingTx)} · match ${txLink(s.matchTx)}</div>
          </div>`;
        })
        .join("");
      return `<div class="agent-card" data-agent="${i}">
        <h3>${esc(a.label)} <span class="muted small">${esc(a.id)}</span></h3>
        <div class="muted small">vault ${addrLink(a.vault)} · hot wallet ${a.hotWallet ? addrLink(a.hotWallet) : "—"}</div>
        ${vault ? `<div class="muted small">SOL ${fmtTok(vault.sol)} · ${(vault.tokens ?? []).map((t) => `${tokenLabel(t.mint)} ${fmtTok(t.uiAmount)}`).join(" · ") || "no tokens"}</div>` : ""}
        ${cards || `<p class="muted small">no vesting schedules yet</p>`}
      </div>`;
    })
    .join("");
  detailEl.innerHTML = "";
}

function renderBounties(el, data) {
  if (!data.bounties.length) {
    el.innerHTML = `<p class="loading">No bounties posted yet.</p>`;
    return;
  }
  el.innerHTML = `<table><thead><tr><th>ID</th><th>Title</th><th>Payout</th><th>Status</th><th>Claim</th></tr></thead><tbody>` +
    data.bounties
      .map((b) => {
        const p = b.payout ?? {};
        const payout = `${fmtUsd(p.usdc)} USDC + ${fmtUsd(p.spcxVesting)} vested SPCX + ${((p.matchBps ?? 0) / 100).toFixed(0)}% match (${((p.feeBps ?? 0) / 100).toFixed(0)}% fee)`;
        return `<tr>
          <td><code>${esc(b.id)}</code></td>
          <td><strong>${esc(b.title)}</strong><br><span class="muted small">${esc(b.acceptanceCriteria ?? "")}</span></td>
          <td class="small">${esc(payout)}</td>
          <td>${esc(b.status)}${b.claimant ? `<br><span class="muted small">${esc(b.claimant)}</span>` : ""}${b.payoutTx ? `<br>${txLink(b.payoutTx)}` : ""}</td>
          <td class="small">${esc(b.howToClaim ?? "")}${b.evidenceUrl ? `<br><a href="${esc(b.evidenceUrl)}" target="_blank" rel="noopener">evidence</a>` : ""}</td>
        </tr>`;
      })
      .join("") +
    `</tbody></table>`;
}

async function renderPolicy(el, data) {
  const md = await optional(fetchText("../policy/allocation-policy-v1.md"));
  const sha = data.policySha256 ? `<p class="muted small">sha256 <code>${esc(data.policySha256)}</code> (recorded in snapshot)</p>` : "";
  el.innerHTML = sha + (md ? `<div class="md">${mdToHtml(md)}</div>` : `<p class="loading">policy file not found in repo.</p>`);
}

async function renderDisclosures(el) {
  const md = await optional(fetchText("disclosures.md"));
  el.innerHTML = md ? `<div class="md">${mdToHtml(md)}</div>` : `<p class="loading">disclosures not found.</p>`;
}

// ------------------------------------------------------------------ boot
function showSnapshotBanner(snapshotTs) {
  $("snapshot-banner").hidden = false;
  $("snapshot-ts").textContent = new Date(snapshotTs * 1000).toLocaleString();
  $("live-badge").textContent = "snapshot";
}

async function loadRegistry() {
  const [vaults, agents, bounties, ledger] = await Promise.all([
    optional(fetchJson("../data/vaults.json")),
    optional(fetchJson("../data/agents.json")),
    optional(fetchJson("../data/bounties.json")),
    optional(fetchJson("../data/vesting-ledger.json")),
  ]);
  return {
    vaults: vaults ?? {},
    agents: (agents && agents.agents) ?? [],
    bounties: (bounties && bounties.bounties) ?? [],
    vestingSchedules: (ledger && ledger.schedules) ?? [],
    vestingSha256: (ledger && ledger.sha256) ?? null,
  };
}

async function tokenHoldingsLive(owner) {
  const out = [];
  for (const [programId, label] of [[TOKEN_PROGRAM_ID, "token"], [TOKEN_2022_PROGRAM_ID, "token-2022"]]) {
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

async function buildLiveData(reg) {
  const vaults = {};
  for (const [name, v] of Object.entries(reg.vaults)) {
    if (!v?.vaultPda) continue;
    const [sol, tokens, sigs] = await Promise.all([
      live.balance(v.vaultPda),
      tokenHoldingsLive(v.vaultPda),
      live.signaturesForAddress(v.vaultPda, 10).catch(() => []),
    ]);
    vaults[name] = {
      multisigPda: v.multisigPda,
      vaultPda: v.vaultPda,
      sol,
      tokens,
      recentSigs: (sigs ?? []).map((s) => ({ signature: s.signature, slot: s.slot, blockTime: s.blockTime })),
    };
  }
  return { mode: "live", ts: Math.floor(Date.now() / 1000), vaults, ...reg };
}

async function buildSnapshotData() {
  const snap = await fetchJson("data.snapshot.json");
  const reg = await loadRegistry();
  return {
    mode: "snapshot",
    ts: snap.snapshotTs,
    vaults: snap.vaults ?? {},
    agents: reg.agents,
    bounties: (snap.bounties ?? []).length ? snap.bounties : reg.bounties,
    vestingSchedules: ((snap.vesting && snap.vesting.schedules) ?? []).length
      ? snap.vesting.schedules
      : reg.vestingSchedules,
    vestingSha256: snap.vesting?.sha256 ?? null,
    policySha256: snap.policy?.sha256 ?? null,
  };
}

async function boot() {
  const reg = await loadRegistry();

  let data = null;
  // Probe the live tier against the treasury vault (or system program pre-01).
  const probeAddr = reg.vaults.treasury?.vaultPda ?? "11111111111111111111111111111111";
  try {
    await live.balance(probeAddr);
    data = await buildLiveData(reg);
    $("live-badge").textContent = "live";
  } catch {
    data = null;
  }

  if (!data) {
    try {
      data = await buildSnapshotData();
      showSnapshotBanner(data.ts);
    } catch {
      document.querySelectorAll(".loading").forEach((el) => {
        el.textContent = "data unavailable — live RPC failed and no snapshot committed yet.";
      });
      return;
    }
  }

  renderTreasury($("treasury-holdings"), data);
  renderYieldEvidence($("yield-evidence"));
  renderAgents($("agents-index"), $("agent-detail"), data);
  renderBounties($("bounty-board"), data);
  await renderPolicy($("allocation-policy"), data);
  await renderDisclosures($("disclosures-body"));
}

document.addEventListener("DOMContentLoaded", boot);
