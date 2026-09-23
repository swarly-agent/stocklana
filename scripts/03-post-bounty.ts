/**
 * 03-post-bounty.ts — appends a bounty row to data/bounties.json (build spec §4).
 *
 *  No chain tx. Usage: tsx scripts/03-post-bounty.ts --id bounty-003
 *  (row body comes from the bounty definition; see data/SCHEMAS.md).
 *
 *  --dry-run: prints the row that would be appended, writes nothing.
 */

const DRY_RUN = process.argv.includes("--dry-run");
const ID = process.argv.find((a) => a.startsWith("--id="))?.split("=")[1];

async function main(): Promise<void> {
  console.log(`[03-post-bounty] id=${ID ?? "(missing)"} dry-run=${DRY_RUN}`);
  console.error("not implemented — see build spec §4");
  process.exit(1);
}

void main();
