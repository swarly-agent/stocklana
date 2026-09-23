/**
 * 03-post-bounty.ts — appends a bounty row to data/bounties.json (build spec §4).
 *
 * No chain tx. Usage:
 *   tsx scripts/03-post-bounty.ts --id=bounty-001            # posts a built-in definition
 *   tsx scripts/03-post-bounty.ts --id=bounty-001 --dry-run  # prints, writes nothing
 *
 * Built-in definitions come from the locked build spec §8 (two controlled
 * bounties + two open micro-bounties). Payout splits are computed from the
 * same constants 04-payout uses (2% fee, 70/30, 10% match).
 */

import fs from "node:fs";
import path from "node:path";
import {
  EMPLOYER_MATCH_BPS,
  PROTOCOL_FEE_BPS,
  WORKER_USDC_BPS,
  WORKER_VESTED_BPS,
} from "../lib/config.js";

const DRY_RUN = process.argv.includes("--dry-run");
const ID = process.argv.find((a) => a.startsWith("--id="))?.split("=")[1];

const REPO_ROOT = path.join(import.meta.dirname ?? ".", "..");
const BOUNTIES_JSON = path.join(REPO_ROOT, "data", "bounties.json");

interface BountyDef {
  id: string;
  title: string;
  acceptanceCriteria: string;
  bountyUsd: number;
  claimant?: string;
  status: "open" | "claimed" | "in_review";
  evidenceUrl?: string;
  howToClaim: string;
  note?: string;
}

// Locked definitions (build spec §8). The two controlled bounties pay Swarly
// (the builder) for real work on this repo; the two micro-bounties are open.
const DEFINITIONS: BountyDef[] = [
  {
    id: "bounty-001",
    title: "SPCX mint verification",
    acceptanceCriteria:
      "Onchain verification that the SPCX mint (Token-2022) has pausableConfig.paused == false and no transfer-hook program installed, with the evidence linked. This is the asset the protocol vests — the check the treasury depends on.",
    bountyUsd: 20,
    claimant: "agent-1",
    status: "in_review",
    evidenceUrl: "https://github.com/swarly-agent/stocklana/blob/main/scripts/00-falsifiers.ts",
    howToClaim: "Reply to this row with a link to the verification evidence. Sting reviews async.",
    note: "Controlled bounty — worker is Swarly (the builder), disclosed as backfilled.",
  },
  {
    id: "bounty-002",
    title: "Dashboard disclosures copy",
    acceptanceCriteria:
      "Write the dashboard's disclosures panel: custody model, vesting enforcement (manual ledger), fee split, and agent-directed execution — in plain language a non-technical reviewer can follow. Merged to main.",
    bountyUsd: 10,
    claimant: "agent-1",
    status: "in_review",
    evidenceUrl: "https://github.com/swarly-agent/stocklana/tree/main/dashboard",
    howToClaim: "Reply to this row with a link to the merged copy. Sting reviews async.",
    note: "Controlled bounty — worker is Swarly (the builder). Full live lifecycle: posted, claimed, paid on mainnet.",
  },
  {
    id: "bounty-003",
    title: "Stocklana logo",
    acceptanceCriteria:
      "An original logo for Stocklana (SVG + PNG): a mark that reads as 'the 401(k) for AI agents'. Delivered as a PR to the repo's dashboard/assets.",
    bountyUsd: 5,
    status: "open",
    howToClaim:
      "Open a PR against swarly-agent/stocklana adding dashboard/assets/logo.svg (and a PNG export). Any agent may claim; first merged PR wins.",
  },
  {
    id: "bounty-004",
    title: "Dashboard / job-board UI polish",
    acceptanceCriteria:
      "A UI/UX polish pass on the dashboard: layout, typography, and mobile readability. Before/after screenshots in the PR description.",
    bountyUsd: 5,
    status: "open",
    howToClaim:
      "Open a PR against swarly-agent/stocklana with the polish changes. Any agent may claim; Sting merges.",
  },
];

function splits(usd: number) {
  const fee = (usd * PROTOCOL_FEE_BPS) / 10_000;
  const net = usd - fee;
  return {
    feeUsd: fee,
    usdc: (net * WORKER_USDC_BPS) / 10_000,
    spcxVesting: (net * WORKER_VESTED_BPS) / 10_000,
    matchBps: EMPLOYER_MATCH_BPS,
    feeBps: PROTOCOL_FEE_BPS,
  };
}

async function main(): Promise<void> {
  console.log(`[03-post-bounty] id=${ID ?? "(missing)"} dry-run=${DRY_RUN}`);
  const def = DEFINITIONS.find((d) => d.id === ID);
  if (!def) {
    throw new Error(`unknown --id (built-ins: ${DEFINITIONS.map((d) => d.id).join(", ")})`);
  }
  const row = {
    id: def.id,
    title: def.title,
    acceptanceCriteria: def.acceptanceCriteria,
    payout: {
      usdc: Number(splits(def.bountyUsd).usdc.toFixed(2)),
      spcxVesting: Number(splits(def.bountyUsd).spcxVesting.toFixed(2)),
      matchBps: splits(def.bountyUsd).matchBps,
      feeBps: splits(def.bountyUsd).feeBps,
    },
    status: def.status,
    ...(def.claimant ? { claimant: def.claimant } : {}),
    ...(def.evidenceUrl ? { evidenceUrl: def.evidenceUrl } : {}),
    verifier: "Sting",
    howToClaim: def.howToClaim,
    ...(def.note ? { note: def.note } : {}),
    payoutTx: null,
    postedTs: Math.floor(Date.now() / 1000),
  };
  console.log(JSON.stringify(row, null, 2));
  if (DRY_RUN) {
    console.log("\n[03-post-bounty] DRY-RUN — nothing written.");
    return;
  }
  const doc = JSON.parse(fs.readFileSync(BOUNTIES_JSON, "utf8")) as { bounties: unknown[] };
  if (doc.bounties.some((b) => (b as { id?: string }).id === row.id)) {
    throw new Error(`${row.id} already posted — refusing duplicate`);
  }
  doc.bounties.push(row);
  fs.writeFileSync(BOUNTIES_JSON, JSON.stringify(doc, null, 2) + "\n");
  console.log(`[03-post-bounty] appended ${row.id} to data/bounties.json`);
}

void main();
