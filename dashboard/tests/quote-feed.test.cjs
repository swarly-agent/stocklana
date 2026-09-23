/* Dashboard render-stub tests: DOM stub + canned fetch, exercises boot, the 60s
   snapshot refresh model (fresh / stale / connecting), the Jupiter quote feed,
   and ET times. */
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
const docListeners = new Map();
global.document = {
  getElementById: (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
  querySelectorAll: (sel) => (global.__openEls || []).filter((e) => e._sel === sel),
  addEventListener: (ev, cb) => { if (ev === "DOMContentLoaded") domReadyCb = cb; docListeners.set(ev, cb); },
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
  "\n;globalThis.__app = { STOCK_QUOTES, et, etFull, etSec, etClock, attemptLive, refreshLiveQuotes, renderFeed, " +
  "renderDataBadge, refreshSoon, rpcAuto, quoteAuto, quoteDelayMs, scheduleQuoteRefresh, quoteLoop, " +
  "get bootCtx() { return bootCtx; }, " +
  "get quotesLiveCount() { return quotesLiveCount; }, " +
  "__clearCache: () => cache.clear() };";
eval(src);
const { STOCK_QUOTES, et, etFull, etClock, attemptLive, refreshLiveQuotes, renderFeed,
  rpcAuto, quoteAuto, quoteDelayMs, __clearCache } = globalThis.__app;
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
  for (const t of [rpcAuto.timer, quoteAuto.timer]) clearTimeout(t);
  Object.assign(rpcAuto, { timer: null, nextAt: 0, inflight: false, lastAttempt: 0 });
  Object.assign(quoteAuto, { fails: 0, timer: null, nextAt: 0 });
  global.__openEls = [];
  for (const q of STOCK_QUOTES) q.live = null;
  Object.assign(global, { __jupDown: false, __jupPartial: false });
  rpcMode = "ok";
  if (setup) setup();
  await domReadyCb();
  await settleRefresh();
  return name;
}

// Vault reads are staggered (400ms between vaults): wait for the background
// refresh to finish instead of a fixed sleep.
async function settleRefresh() {
  const t0 = Date.now();
  while (rpcAuto.inflight && Date.now() - t0 < 8000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 25));
}

(async () => {
  // 1. IDs referenced by JS exist in HTML
  for (const id of ["tape-aum", "tape-stocks", "et-clock", "snap-banner", "snap-text", "retry-note", "retry-live",
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

  // 4. RPC ok + full Jupiter feed: fresh snapshot, honest badge
  await scenario("live", null);
  const ctx = bootCtx();
  ok(ctx.balancesError === "", "no balance error, got " + ctx.balancesError);
  ok(ctx.balancesAt > 0, "balances timestamped");
  const badgeTxt = els.get("mode-text").textContent;
  ok(/^AS OF \d{2}:\d{2}:\d{2} ET$/.test(badgeTxt), "badge shows AS OF time, got " + badgeTxt);
  ok(els.get("mode-text").style.color === "var(--green)", "badge green when fresh");
  ok(els.get("snap-banner").hidden === true, "banner hidden when fresh");
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

  // 5. One vault's RPC fails -> stale banner naming the vault, others stay fresh
  await scenario("degraded", () => { rpcMode = "agent2-down"; });
  const dctx = bootCtx();
  ok(/agent2/.test(dctx.balancesError), "error names the failed vault, got " + dctx.balancesError);
  ok(els.get("mode-text").style.color === "var(--amber)", "badge amber when stale");
  ok(els.get("snap-banner").hidden === false, "banner visible when stale");
  const degTxt = els.get("snap-text").innerHTML;
  ok(/PARTIAL REFRESH/.test(degTxt) && /agent2/.test(degTxt), "banner says partial + names vault");
  ok(els.get("retry-live").hidden === false, "retry button visible");
  ok(dctx.vaults.agent2.tokens !== undefined, "agent2 falls back to snapshot shape");
  ok(dctx.vaults.treasury.sol === 54511560 / 1e9, "healthy vaults still refresh live");

  // 6. RPC fully down -> last-good snapshot kept, stale banner with reason + retry
  await scenario("snapshot", () => { rpcMode = "down"; });
  const sctx = bootCtx();
  ok(sctx.balancesError !== "", "error recorded");
  ok(sctx.balancesAt === SNAP.snapshotTs * 1000, "timestamp stays at last good (snapshot)");
  ok(els.get("mode-text").style.color === "var(--amber)", "badge amber");
  const snapTxt = els.get("snap-text").innerHTML;
  ok(/BALANCES STALE/.test(snapTxt) && /ET/.test(snapTxt) && !/UTC/.test(snapTxt), "banner stale, ET, no UTC");
  ok(/fetch failed/.test(snapTxt), "banner surfaces the RPC error");
  ok(els.get("retry-live").hidden === false, "retry button visible");

  // 7. Quote feed down -> REF fallback tape, AUM on ref mark
  await scenario("quotes-down", () => { global.__jupDown = true; });
  ok(STOCK_QUOTES.every((q) => !q.live), "no live quotes (fresh boot, feed down)");
  ok(/REF ONLY/.test(els.get("tape-stocks").innerHTML), "tape falls back to REF");
  ok(bootCtx().spcxMark === bootCtx().spcxImplied, "mark falls back to implied");

  // 8. Partial quotes -> LIVE n/34
  await scenario("partial", () => { global.__jupPartial = true; });
  ok(quotesLiveCount() === 2, "partial live count, got " + quotesLiveCount());
  ok(/LIVE 2\/34/.test(els.get("tape-stocks").innerHTML), "tape shows LIVE 2/34");

  // 9. Manual attemptLive after recovery clears the stale banner
  await scenario("retry", () => { rpcMode = "down"; });
  ok(bootCtx().balancesError !== "", "pre-retry stale");
  rpcMode = "ok";
  await attemptLive();
  ok(bootCtx().balancesError === "", "post-retry fresh, got " + bootCtx().balancesError);
  ok(els.get("snap-banner").hidden === true, "banner hidden after recovery");

  // 10. Quote-feed backoff math (unchanged tier)
  ok(quoteDelayMs(0) === 60000, "quote delay healthy 60s");
  ok(quoteDelayMs(1) === 120000, "quote delay 120s after 1 fail");
  ok(quoteDelayMs(2) === 240000, "quote delay 240s after 2 fails");
  ok(quoteDelayMs(9) === 300000, "quote delay capped 300s");

  // 11. RPC down -> flat 60s retry scheduled (no exponential backoff)
  await scenario("auto-retry", () => { rpcMode = "down"; });
  ok(bootCtx().balancesError !== "", "auto-retry pre stale");
  ok(rpcAuto.timer !== null, "retry timer scheduled");
  const waitMs = rpcAuto.nextAt - Date.now();
  ok(waitMs > 30_000 && waitMs <= 60_000, "retry in ~60s, got " + waitMs);

  // 12. Banner RETRY LIVE click forces a refresh and recovers
  rpcMode = "ok";
  docListeners.get("click")({ target: { closest: (sel) => (sel === "#retry-live" ? {} : null) } });
  await new Promise((r) => setTimeout(r, 400)); // refreshSoon(250) timer
  await settleRefresh();
  ok(bootCtx().balancesError === "", "manual retry recovers, got " + bootCtx().balancesError);
  ok(els.get("snap-banner").hidden === true, "banner hidden after manual retry");

  // 13. Quote feed down -> failures counted, retry scheduled
  await scenario("quote-backoff", () => { global.__jupDown = true; });
  ok(quoteAuto.fails >= 1, "quote fails counted, got " + quoteAuto.fails);
  ok(quoteAuto.timer !== null, "quote retry scheduled");
  ok(/quote-retry-note/.test(els.get("tape-stocks").innerHTML), "tape has quote retry note slot");

  // 14. Wire gate: null wireStartTs -> honest empty state, no old history leaks in
  await scenario("feed-gate", null);
  const fbGate = els.get("feed-body").innerHTML;
  ok(/OPENS WITH THE FULL-ECONOMICS TEST/.test(fbGate), "wire shows honest empty state before the gate");
  ok(/opens with the full-economics test/.test(els.get("feed-meta").textContent), "feed meta explains the gate");
  ok(!/ACQUISITION|ALLOCATION/.test(fbGate), "no old-economy rows before the gate");

  // 15. Wire opens once the gate is set: only entries >= startTs render,
  // grouped per agent, and expanded groups survive re-renders
  const wctx = bootCtx();
  const nowSec = Math.floor(Date.now() / 1000);
  wctx.wireStartTs = nowSec - 7200;
  wctx.txRegistry = {
    "sigA1111111111111111111111111111111111111111111111111111": { label: "AGENT SWAP · $10 USDC → SPCX VIA JUPITER", type: "swap", usdVolume: 10, agent: "agent1", ts: nowSec - 3600 },
    "sigB2222222222222222222222222222222222222222222222222222": { label: "PAYOUT · $20 INCENTIVE → AGENT-1", type: "payout", usdVolume: 20, agent: "agent1", ts: nowSec - 1800 },
    "sigOld33333333333333333333333333333333333333333333333333": { label: "OLD SWAP (pre-gate)", type: "swap", usdVolume: 5, agent: "agent1", ts: nowSec - 10800 },
  };
  global.__openEls = [{ _sel: "#feed-body .feed-group.open", getAttribute: () => "g-agent1" }];
  renderFeed(wctx);
  const fb = els.get("feed-body").innerHTML;
  ok(fb.includes('data-group="g-agent1"') && /feed-group open/.test(fb), "expanded group survives re-render");
  ok(fb.includes("sigA111") && fb.includes("sigB222"), "post-gate events render");
  ok(!fb.includes("sigOld333"), "pre-gate entries excluded");
  ok(/data-feed-filter="swaps"/.test(fb) && /data-feed-filter="payouts"/.test(fb) && /data-feed-filter="vesting"/.test(fb),
    "filters are ALL/SWAPS/PAYOUTS/VESTING");
  ok(!/data-feed-filter="matches"|data-feed-filter="bounties"/.test(fb), "no MATCHES/BOUNTIES filters");

  // 16. F1 rebuild: no bounty/policy language, 7d bars + AUM history present
  const f1 = els.get("ov-aum").innerHTML + els.get("ov-mix").innerHTML +
    els.get("ov-activity").innerHTML + els.get("ov-accounts").innerHTML;
  ok(/TOTAL ASSETS IN CUSTODY/.test(els.get("ov-aum").innerHTML), "F1 header is custody language");
  ok(!/POLICY|SPCX MARK|bounty/i.test(f1), "no bounty/policy rows in F1");
  ok(/vol-bar/.test(els.get("ov-activity").innerHTML), "7d swap-volume bars render");
  ok(/aum-chart|accumulating today/.test(els.get("ov-activity").innerHTML), "AUM history chart or honest note");
  ok(/VESTING/.test(els.get("ov-mix").innerHTML), "F1 mix shows liquid-vs-vesting");
  ok(/donut/.test(els.get("ov-accounts").innerHTML) && /NEW THIS WEEK/.test(els.get("ov-accounts").innerHTML),
    "F1 accounts has AUM donut + new-this-week");

  // 17. F2 data-driven: agents from snapshot, searchable, no hardcoded econ language
  const f2 = els.get("agents-body").innerHTML;
  ok(/AGENT-1/.test(f2) && /AGENT-2/.test(f2), "agent cards render from snapshot agents");
  ok(/id="agents-search"/.test(f2), "F2 has vault-address search");
  ok(!/EARNED|50\/50|employer match/i.test(f2), "no earned/match/50-50 language in F2");
  ok(/ACCOUNT VALUE/.test(f2) && /LIQUID/.test(f2) && /VESTING SCHEDULES/.test(f2), "F2 summary cells + vesting");

  // 18. Address regression: vault addresses always come from the committed
  // snapshot, so a mangled ctx.vaults can't break the next refresh
  await scenario("probe-regression", () => { rpcMode = "agent2-down"; });
  delete bootCtx().vaults.treasury; // simulate prior degraded load without treasury
  rpcMode = "ok";
  await attemptLive();
  ok(bootCtx().vaults.treasury && bootCtx().vaults.treasury.sol === 54511560 / 1e9,
    "treasury restored from snapshot addresses");
  ok(bootCtx().balancesError === "", "fresh after recovery");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
