/**
 * 00-falsifiers.ts — READ-ONLY kill-line checks, evaluated in order (build spec §4).
 *
 *  (1) SPCX pausableConfig.paused == false, no transfer-hook program installed
 *      (SPCX is the asset we acquire, vest, and move — DKNG is evidence-panel
 *      only; no script touches it)
 *  (2) ALLINU full extension list (fee only vs hook/delegate)
 *  (3) Jupiter /swap/v2/build quotes AND successful simulations at demo size
 *      for USDC→SPCX — the treasury's ~$12 acquisition AND the agent's ~$5
 *      self-directed allocation (SPCX liquidity unverified: guilty until
 *      proven innocent)
 *  (4) Create vault, receive + transfer dust Token-2022 SPCX — NOT RUN HERE.
 *      Check #4 spends real SOL and stays on Wednesday's schedule.
 *
 * Prints PASS/FAIL/BLOCKED per check with the evidence (account data / quote /
 * sim results) and writes the same report to
 * ~/workspace/stocklana/research/falsifier-results-2026-09-22.md
 *
 * Sends no transactions. Unsigned simulations only. Never touches
 * ~/workspace/stocklana/hidden_files/ (treasury keypair) and never loads
 * any secret. Public keys and signatures only, via lib/safe-log.ts.
 *
 * Exit code: 0 unless a check FAILs (kill-line semantics).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MINTS, TREASURY_WALLET } from "../lib/config.js";
import {
  assembleVersionedTx,
  jupBuild,
  txToBase64,
} from "../lib/jupiter.js";
import { rpcCall } from "../lib/rpc.js";
import { pub } from "../lib/safe-log.js";

const RESULTS_PATH = path.join(
  os.homedir(),
  "workspace/stocklana/research/falsifier-results-2026-09-22.md",
);

// Demo-size amounts in atomic USDC (6 decimals). Sting-locked: $12 treasury
// acquisition (02b), $5 agent self-directed allocation (05-allocate).
const SIZES = [
  { label: "$12 treasury acquisition", atomic: "12000000" },
  { label: "$5 agent allocation", atomic: "5000000" },
] as const;

type Verdict = "PASS" | "FAIL" | "BLOCKED";

interface CheckResult {
  n: number;
  name: string;
  verdict: Verdict;
  detail: string[];
}

const report: string[] = [];
function say(line = ""): void {
  report.push(line);
  console.log(line);
}

// ------------------------------------------------- checks 1 & 2: extensions

interface MintExtensions {
  program: string;
  decimals: number;
  supply: string;
  extensions: { extension: string; state: Record<string, unknown> }[];
}

async function getMintExtensions(mint: string): Promise<MintExtensions> {
  const res = (await rpcCall("getAccountInfo", [
    mint,
    { encoding: "jsonParsed", commitment: "confirmed" },
  ])) as {
    value: {
      data: {
        parsed?: { info?: Record<string, unknown>; type?: string };
        program?: string;
      };
    } | null;
  };
  if (!res?.value) throw new Error(`mint account not found onchain: ${mint}`);
  const info = res.value.data?.parsed?.info ?? {};
  const rawExt = info["extensions"];
  const extensions = Array.isArray(rawExt)
    ? rawExt.map((e) => ({
        extension: String((e as { extension?: unknown }).extension ?? "?"),
        state: ((e as { state?: unknown }).state ?? {}) as Record<
          string,
          unknown
        >,
      }))
    : [];
  return {
    program: String(res.value.data?.program ?? "?"),
    decimals: Number(info["decimals"] ?? -1),
    supply: String(info["supply"] ?? "?"),
    extensions,
  };
}

function checkExtensions(
  n: number,
  name: string,
  mint: string,
  data: MintExtensions,
  opts: { forbidHook: boolean; requireUnpaused: boolean },
): CheckResult {
  const detail: string[] = [];
  detail.push(`### Check ${n}: ${name}`);
  detail.push(`mint: ${mint}`);
  detail.push(`program: ${data.program} · decimals: ${data.decimals}`);
  detail.push(
    `extensions (${data.extensions.length}): ${data.extensions.map((e) => e.extension).join(", ") || "(none)"}`,
  );
  for (const e of data.extensions) {
    detail.push(`- ${e.extension}: ${JSON.stringify(e.state)}`);
  }

  let verdict: Verdict = "PASS";
  const find = (frag: string) =>
    data.extensions.find((e) =>
      e.extension.toLowerCase().includes(frag.toLowerCase()),
    );

  const pausable = find("paus");
  if (pausable) {
    const paused = (pausable.state as { paused?: unknown }).paused;
    if (paused === true) {
      verdict = "FAIL";
      detail.push("  KILL: pausable extension is PAUSED — transfers are frozen.");
    } else {
      detail.push(`  pausable present, paused=${String(paused)} — not frozen.`);
    }
    detail.push(
      `  pause authority: ${String((pausable.state as { authority?: unknown }).authority)}`,
    );
  } else if (opts.requireUnpaused) {
    detail.push("  no pausable extension installed — cannot be paused.");
  }

  const hook = find("transferhook");
  if (hook) {
    const programId = (hook.state as { programId?: unknown }).programId;
    if (programId == null) {
      detail.push(
        "  transfer-hook extension slot present but NO program installed (programId null) — transfers do not invoke external code.",
      );
      detail.push(
        "  note: the hook authority could install a program later — this is why the pause/hook recheck runs again before submission.",
      );
    } else {
      detail.push(`  transfer-hook program: ${String(programId)}`);
      if (opts.forbidHook) {
        verdict = "FAIL";
        detail.push(
          "  KILL: transfer-hook program installed — every transfer executes foreign code.",
        );
      }
    }
  } else {
    detail.push("  no transfer-hook extension — transfers are plain.");
  }

  const perm = find("permanentdelegate");
  if (perm) {
    detail.push(
      `  permanentDelegate: ${String((perm.state as { delegate?: unknown }).delegate ?? "?")} — the ISSUER can transfer/burn ANY holder's tokens, including agent vaults.`,
    );
    detail.push(
      "  disclosure item, not a kill: documented in bounty #1's issuer-authority disclosure and the dashboard.",
    );
  }

  detail.push(`verdict: ${verdict}`);
  return { n, name, verdict, detail };
}

// ------------------------------------------------- check 3: jupiter route

interface SimResult {
  success: boolean;
  unitsConsumed: number | null;
  error: string | null;
  logsHead: string[];
}

async function simulate(txBase64: string): Promise<SimResult> {
  const res = (await rpcCall("simulateTransaction", [
    txBase64,
    {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: false,
      innerInstructions: false,
      commitment: "confirmed",
    },
  ])) as {
    err: unknown;
    unitsConsumed?: number;
    logs?: string[];
  };
  return {
    success: res.err == null,
    unitsConsumed:
      typeof res.unitsConsumed === "number" ? res.unitsConsumed : null,
    error: res.err == null ? null : JSON.stringify(res.err).slice(0, 500),
    logsHead: Array.isArray(res.logs) ? res.logs.slice(0, 5) : [],
  };
}

async function checkJupiter(): Promise<CheckResult> {
  const detail: string[] = [];
  detail.push("### Check 3: Jupiter USDC→SPCX at exact demo size");
  detail.push(`input: USDC ${MINTS.USDC}`);
  detail.push(`output: SPCX ${MINTS.SPCX}`);
  detail.push(`taker (read-only quote/sim): ${TREASURY_WALLET}`);
  detail.push(
    "slippageBps: 100 (explicit) · wrapAndUnwrapSol: false (explicit)",
  );
  detail.push(
    "note: v2/build returns instruction components (no prebuilt tx); the script assembles the VersionedTransaction itself (same assembly 02b/05 use Wednesday) and simulates it unsigned.",
  );

  let verdict: Verdict = "PASS";
  const failures: string[] = [];

  for (const size of SIZES) {
    detail.push(``);
    detail.push(`#### ${size.label} (${size.atomic} micro-USDC)`);
    let built: Awaited<ReturnType<typeof jupBuild>>;
    try {
      built = await jupBuild(size.atomic);
    } catch (e) {
      built = {
        kind: "failed",
        reason: `transport error: ${(e as Error).message}`,
      };
    }

    if (built.kind === "blocked") {
      verdict = "BLOCKED";
      detail.push("verdict for this leg: BLOCKED-ON-KEY");
      detail.push("exact wall:");
      for (const l of built.reason.split("\n")) detail.push(`  ${l}`);
      detail.push(
        "meaning: keyless Jupiter route unavailable; Sting's API key unblocks this check.",
      );
      continue;
    }
    if (built.kind === "failed") {
      verdict = "FAIL";
      failures.push(`${size.label}: build failed — ${built.reason}`);
      detail.push("verdict for this leg: FAIL");
      for (const l of built.reason.split("\n")) detail.push(`  ${l}`);
      continue;
    }

    const b = built.build;
    const inN = Number(b.inAmount);
    const outN = Number(b.outAmount);
    const impliedPrice =
      Number.isFinite(inN) && Number.isFinite(outN) && outN > 0
        ? (inN / outN).toFixed(4)
        : "?";
    detail.push(
      `quote via ${b.source}: in=${b.inAmount} out=${b.outAmount} (≈$${impliedPrice}/SPCX, both 6dp)`,
    );
    detail.push(
      `priceImpactPct=${b.priceImpactPct} slippageBps=${b.slippageBps} otherAmountThreshold=${b.otherAmountThreshold}`,
    );
    detail.push(`route: ${b.routePlan}`);
    detail.push(`response keys: ${b.rawShapeKeys.join(", ")}`);

    let txB64: string;
    try {
      const tx = await assembleVersionedTx(b, TREASURY_WALLET);
      txB64 = txToBase64(tx);
      detail.push(
        `assembled VersionedTransaction: ${tx.message.compiledInstructions.length} instructions, ${tx.message.addressTableLookups.length} ALT lookups, ${txB64.length} chars base64`,
      );
    } catch (e) {
      verdict = "FAIL";
      failures.push(
        `${size.label}: tx assembly failed — ${(e as Error).message}`,
      );
      detail.push(`assembly error: ${(e as Error).message}`);
      detail.push("verdict for this leg: FAIL");
      continue;
    }

    let sim: SimResult;
    try {
      sim = await simulate(txB64);
    } catch (e) {
      verdict = "FAIL";
      failures.push(
        `${size.label}: simulation transport error — ${(e as Error).message}`,
      );
      detail.push(`simulation transport error: ${(e as Error).message}`);
      detail.push("verdict for this leg: FAIL");
      continue;
    }
    detail.push(
      `simulation: success=${sim.success} unitsConsumed=${String(sim.unitsConsumed)}`,
    );
    if (!sim.success) {
      verdict = "FAIL";
      failures.push(`${size.label}: simulation failed — ${sim.error}`);
      detail.push(`  sim error: ${sim.error}`);
      for (const l of sim.logsHead) detail.push(`  log: ${l}`);
      detail.push("verdict for this leg: FAIL");
    } else {
      detail.push("verdict for this leg: PASS");
    }
  }

  detail.push(``);
  if (verdict === "FAIL") {
    detail.push("KILL: USDC→SPCX route is not executable at demo size.");
    for (const f of failures) detail.push(`  - ${f}`);
  } else if (verdict === "BLOCKED") {
    detail.push(
      "NOT FAILED: route is untested, not disproven. Re-run after Sting's Jupiter API key lands.",
    );
  } else {
    detail.push(
      "Route is REAL at both demo sizes: quotes + successful simulations. Wednesday's 02b/05 legs are unblocked on the route question.",
    );
  }
  detail.push(`verdict: ${verdict}`);
  return { n: 3, name: "Jupiter USDC→SPCX at demo size", verdict, detail };
}

// -------------------------------------------------------------------- main

async function main(): Promise<void> {
  say("# Stocklana falsifiers — 2026-09-22 (checks 1–3)");
  say("");
  say(
    "Read-only. No transactions sent, no signatures produced, no keypairs created.",
  );
  say(
    "Check #4 (vault creation / dust SPCX transfer) intentionally not run — Wednesday.",
  );
  say("");

  const results: CheckResult[] = [];

  try {
    pub("SPCX mint", MINTS.SPCX);
    const spcx = await getMintExtensions(MINTS.SPCX);
    results.push(
      checkExtensions(1, "SPCX mint extensions", MINTS.SPCX, spcx, {
        forbidHook: true,
        requireUnpaused: true,
      }),
    );
  } catch (e) {
    results.push({
      n: 1,
      name: "SPCX mint extensions",
      verdict: "FAIL",
      detail: [`read error: ${(e as Error).message}`, "verdict: FAIL"],
    });
  }

  try {
    pub("ALLINU mint", MINTS.ALLINU);
    const allinu = await getMintExtensions(MINTS.ALLINU);
    results.push(
      checkExtensions(2, "ALLINU mint extensions", MINTS.ALLINU, allinu, {
        forbidHook: false, // informational: fee-only vs hook/delegate
        requireUnpaused: false,
      }),
    );
  } catch (e) {
    results.push({
      n: 2,
      name: "ALLINU mint extensions",
      verdict: "FAIL",
      detail: [`read error: ${(e as Error).message}`, "verdict: FAIL"],
    });
  }

  try {
    results.push(await checkJupiter());
  } catch (e) {
    results.push({
      n: 3,
      name: "Jupiter USDC→SPCX at demo size",
      verdict: "FAIL",
      detail: [`unexpected error: ${(e as Error).message}`, "verdict: FAIL"],
    });
  }

  say("## Results");
  say("");
  for (const r of results) {
    for (const l of r.detail) say(l);
    say("");
  }

  say("## Summary");
  for (const r of results) say(`- Check ${r.n} (${r.name}): ${r.verdict}`);
  say("");
  say(
    "Check #4 (vault creation + dust SPCX receive/transfer) not run — spends real SOL, stays on Wednesday's schedule.",
  );

  const stamp = new Date().toISOString();
  const header = `<!-- generated by scripts/00-falsifiers.ts at ${stamp} -->\n\n`;
  fs.writeFileSync(RESULTS_PATH, header + report.join("\n") + "\n");
  console.log(`\nreport written: ${RESULTS_PATH}`);

  const failed = results.some((r) => r.verdict === "FAIL");
  if (failed) {
    console.error(
      "\nKILL-LINE: at least one check FAILED — stop, consult kill-lines.",
    );
    process.exit(1);
  }
}

void main();
