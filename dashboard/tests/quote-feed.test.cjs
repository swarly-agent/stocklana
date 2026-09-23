/* Dashboard render-stub tests: DOM stub + canned fetch, exercises boot, live-tier
   states (live / degraded / snapshot), the Jupiter quote feed, and ET times. */
"use strict";
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const SNAP = JSON.parse(fs.readFileSync(path.join(REPO, "data.snapshot.json"), "utf8"));

const AGENT2_PDA = (SNAP.vaults.agent2 || {}).vaultPda;

// ---------- DOM stub ----------
const els = new Map();
function makeEl(id) {
  return {
    id, innerHTML: "", textContent: "", hidden: true, className: "",
    style: {}, title: "",
    querySelector: () => ({ className: "", style: {} }),
    querySelectorAll: () => [],
    setAttribute: () => {},
  };
}
let domReadyCb = null;
global.document = {
  getElementById: (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
  querySelectorAll: () => [],
  addEventListener: (ev, cb) => { if (ev === "DOMContentLoaded") domReadyCb = cb; },
  createElement: () => ({ style: {}, appendChild: () => {}, select: () => {} }),
  body: { appendChild: () => {}, removeChild: () => {} },
};
global.window = global;
try { global.navigator = {}; } catch { /* node>=22 getter-only */ }

// ---------- fetch stub ----------
let rpcMode = "ok"; // "ok" | "agent2-down" | "down"
const JUP = {};
for (const [sym, px] of [["SPCX", 151.39], ["MU", 1065.18], ["BA", 201.78]]) {
  // filled in per-test from canned map
}
const CANNED_JUP = {
  "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb": { usdPrice: 151.39, priceChange24h: -1.35 },
  "MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1": { usdPrice: 1065.18, priceChange24h: -1.35 },
};
global.fetch = async (url, opts = {}) => {
  if (url === "data.snapshot.json") return { ok: true, json: async () => SNAP };
  if (url === "../data/agents.json") return { ok: false, status: 404 };
  if (String(url).startsWith("https://lite-api.jup.ag/price/v3")) {
    if (global.__jupDown) throw new Error("jup unreachable");
    return { ok: true, json: async () => (global.__jupPartial ? CANNED_JUP : fullJup()) };
  }
  if (opts.method === "POST") { // RPC
    if (rpcMode === "down") throw new Error("fetch failed");
    const body = JSON.parse(opts.body);
    if (body.method === "getTokenAccountsByOwner" && rpcMode === "agent2-down" && body.params[0] === AGENT2_PDA)
      throw new Error("http 429");
    const result = body.method === "getBalance" ? { value: 54511560 }
      : body.method === "getTokenAccountsByOwner" ? { value: [] }
      : [];
    return { ok: true, json: async () => ({ result }) };
  }
  throw new Error("unexpected fetch: " + url);
};
function fullJup() {
  const out = {};
  const src = fs.readFileSync(path.join(REPO, "app.js"), "utf8");
  const mints = [...src.matchAll(/mint: "([A-Za-z0-9]{43,44})"/g)].map((m) => m[1]);
  for (const m of mints) out[m] = { usdPrice: 100, priceChange24h: 1.5 };
  out["SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb"] = { usdPrice: 151.39, priceChange24h: -1.35 };
  return out;
}

// ---------- load app ----------
const src = fs.readFileSync(path.join(REPO, "app.js"), "utf8") +
  "\n;globalThis.__app = { STOCK_QUOTES, et, etFull, etSec, attemptLive, refreshLiveQuotes, " +
  "get bootCtx() { return bootCtx; }, " +
  "get quotesLiveCount() { return quotesLiveCount; }, " +
  "__clearCache: () => cache.clear() };";
eval(src);
const { STOCK_QUOTES, et, etFull, attemptLive, __clearCache } = globalThis.__app;
const quotesLiveCount = () => globalThis.__app.quotesLiveCount;
const bootCtx = () => globalThis.__app.bootCtx;

// ---------- assertions ----------
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; } else { fail++; console.error("FAIL:", name); }
}
const htmlHas = (id) => fs.readFileSync(path.join(REPO, "index.html"), "utf8").includes(`id="${id}"`);

async function scenario(name, setup) {
  els.clear();
  __clearCache();
  for (const q of STOCK_QUOTES) q.live = null;
  Object.assign(global, { __jupDown: false, __jupPartial: false });
  rpcMode = "ok";
  if (setup) setup();
  await domReadyCb();
  // let pending promises settle
  await new Promise((r) => setTimeout(r, 50));
  return name;
}

(async () => {
  // 1. IDs referenced by JS exist in HTML
  for (const id of ["tape-aum", "tape-stocks", "et-clock", "snap-banner", "snap-text", "retry-live",
      "mode-badge", "mode-text", "net-dot", "ov-aum", "ov-mix", "ov-activity", "ov-accounts",
      "agents-body", "agents-meta", "feed-body", "feed-meta", "bounties-body", "bounties-meta"])
    ok(htmlHas(id), "html has #" + id);
  ok(!/id="utc-clock"|id="snap-ts"/.test(fs.readFileSync(path.join(REPO, "index.html"), "utf8")), "no stale utc-clock/snap-ts ids");

  // 2. Quote universe
  ok(STOCK_QUOTES.length === 34, "34 quotes, got " + STOCK_QUOTES.length);
  const mints = STOCK_QUOTES.map((q) => q.mint);
  ok(new Set(mints).size === 34, "mints unique");
  ok(mints.every((m) => /^[A-Za-z0-9]{43,44}$/.test(m)), "mints well-formed");
  ok(STOCK_QUOTES.find((q) => q.sym === "SPCX").mint === "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb", "SPCX mint");
  ok(STOCK_QUOTES.find((q) => q.sym === "BA").mint === "BArimz1PcKZr8PcPh3tcZ2dg4S7FJLk3cw6R5F8GsHKg", "BA mint fixed (not MU)");
  ok(!STOCK_QUOTES.some((q) => /Sting/i.test(q.name || "")), "no names leak");

  // 3. ET time formatting (snapshot ts -> America/New_York)
  const ts = SNAP.snapshotTs;
  const { execSync } = require("child_process");
  const expect = execSync(`TZ=America/New_York date -d @${ts} "+%m-%d %H:%M"`).toString().trim();
  ok(et(ts) === expect, `et() matches system tz (${et(ts)} vs ${expect})`);
  ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(etFull(ts)), "etFull shape");

  // 4. Live RPC ok + full Jupiter feed
  await scenario("live", null);
  const ctx = bootCtx();
  ok(ctx.mode === "live", "mode live, got " + ctx.mode);
  ok(els.get("mode-text").textContent === "LIVE", "badge LIVE");
  ok(els.get("snap-banner").hidden === true, "banner hidden when live");
  ok(quotesLiveCount() === 34, "34 live quotes, got " + quotesLiveCount());
  ok(ctx.spcxMark === 151.39, "SPCX mark follows live quote, got " + ctx.spcxMark);
  ok(ctx.priceSource === "live", "priceSource live");
  const tape = els.get("tape-stocks").innerHTML;
  ok(tape.includes("● LIVE 34/34 ONCHAIN · JUPITER"), "tape shows LIVE 34/34");
  ok(tape.includes("ET</span>"), "tape timestamp in ET");
  const aum = els.get("tape-aum").innerHTML;
  ok(aum.includes("$151.39") && aum.includes("LIVE"), "AUM tape uses live SPCX mark");
  ok(!/UTC/.test(els.get("ov-activity").innerHTML), "no UTC in overview");
  ok(/ET/.test(els.get("ov-activity").innerHTML), "ET in overview reference");
  ok(!/verifier: Sting/.test(els.get("bounties-meta").textContent), "verifier anonymized");

  // 5. Degraded: agent2 RPC fails -> LIVE* with per-vault fallback
  await scenario("degraded", () => { rpcMode = "agent2-down"; });
  ok(bootCtx().mode === "degraded", "mode degraded, got " + bootCtx().mode);
  ok(els.get("mode-text").textContent === "LIVE*", "badge LIVE*");
  ok(els.get("snap-banner").hidden === false, "banner visible when degraded");
  ok(/DEGRADED/.test(els.get("snap-text").innerHTML), "banner says degraded");
  ok(els.get("retry-live").hidden === false, "retry button visible");
  ok(bootCtx().vaults.agent2.tokens !== undefined, "agent2 falls back to snapshot shape");

  // 6. Snapshot: RPC fully down -> banner with reason + retry
  await scenario("snapshot", () => { rpcMode = "down"; });
  ok(bootCtx().mode === "snapshot", "mode snapshot, got " + bootCtx().mode);
  ok(els.get("mode-text").textContent === "SNAPSHOT", "badge SNAPSHOT");
  const snapTxt = els.get("snap-text").innerHTML;
  ok(/SNAPSHOT MODE/.test(snapTxt) && /ET/.test(snapTxt) && !/UTC/.test(snapTxt), "banner ET, no UTC");
  ok(/fetch failed/.test(snapTxt), "banner surfaces the RPC error");

  // 7. Quote feed down -> REF fallback tape, AUM on ref mark
  await scenario("quotes-down", () => { global.__jupDown = true; });
  ok(STOCK_QUOTES.every((q) => !q.live), "no live quotes (fresh boot, feed down)");
  ok(/REF ONLY/.test(els.get("tape-stocks").innerHTML), "tape falls back to REF");
  ok(bootCtx().spcxMark === bootCtx().spcxImplied, "mark falls back to implied");

  // 8. Partial quotes -> LIVE n/34
  await scenario("partial", () => { global.__jupPartial = true; });
  ok(quotesLiveCount() === 2, "partial live count, got " + quotesLiveCount());
  ok(/LIVE 2\/34/.test(els.get("tape-stocks").innerHTML), "tape shows LIVE 2/34");

  // 9. Retry button re-runs the live tier
  await scenario("retry", () => { rpcMode = "down"; });
  ok(bootCtx().mode === "snapshot", "pre-retry snapshot");
  rpcMode = "ok";
  await attemptLive();
  await new Promise((r) => setTimeout(r, 50));
  ok(bootCtx().mode === "live", "post-retry live, got " + bootCtx().mode);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
