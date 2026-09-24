// 10-rent-sweep.ts — close executed Squads Transaction/Proposal PDAs and sweep
// rent to the multisig's configured rentCollector (the treasury member key).
//
// Read-only probe (09) found: agent1 indices 1,2,3 open (~0.01285 SOL total);
// treasury + agent2 clean. vaultTransactionAccountsClose is a direct program
// ix: no proposal needed, no multisig signer required — the fee payer signs.
//
// Usage: npx tsx scripts/10-rent-sweep.ts            (dry run: simulate only)
//        npx tsx scripts/10-rent-sweep.ts --live     (simulate, then send)
import { PublicKey } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import fs from "node:fs";
import { getConnection, loadKeypair, sendWithSizing, simulateOnly } from "../lib/squads.js";
import { pub, sig } from "../lib/safe-log.js";

const LIVE = process.argv.includes("--live");
const vaults = JSON.parse(fs.readFileSync("data/vaults.json", "utf8"));

async function main() {
  const connection = await getConnection();
  const payerKp = loadKeypair("squads-member-keypair.json"); // = rentCollector on all vaults
  const payer = payerKp.publicKey;

  const bal = await connection.getBalance(payer, "confirmed");
  console.log(`payer/rentCollector ${payer.toBase58()} balance: ${bal / 1e9} SOL`);

  for (const [name, v] of Object.entries<any>(vaults)) {
    if (!v.multisigPda) continue;
    const multisigPda = new PublicKey(v.multisigPda);
    const info = await connection.getAccountInfo(multisigPda, "confirmed");
    if (!info) continue;
    const [state] = multisig.accounts.multisigBeet.deserialize(info.data);
    const rentCollector = new PublicKey(state.rentCollector as Uint8Array);
    if (!rentCollector.equals(payer)) {
      console.log(`[${name}] rentCollector ${rentCollector.toBase58()} != payer — SKIPPING (would not sweep to main account)`);
      continue;
    }
    const txIndex = BigInt(state.transactionIndex as unknown as string);
    const ixs = [];
    let reclaim = 0;
    for (let i = 1n; i <= txIndex; i++) {
      const [txPda] = multisig.getTransactionPda({ multisigPda, index: i });
      const [propPda] = multisig.getProposalPda({ multisigPda, transactionIndex: i });
      const [txInfo, propInfo] = await Promise.all([
        connection.getAccountInfo(txPda, "confirmed"),
        connection.getAccountInfo(propPda, "confirmed"),
      ]);
      if (txInfo || propInfo) {
        reclaim += (txInfo?.lamports ?? 0) + (propInfo?.lamports ?? 0);
        ixs.push(
          multisig.instructions.vaultTransactionAccountsClose({
            multisigPda,
            rentCollector,
            transactionIndex: i,
          })
        );
        console.log(`[${name}] index ${i}: reclaim ${(txInfo?.lamports ?? 0) + (propInfo?.lamports ?? 0)} lamports`);
      }
    }
    if (!ixs.length) {
      console.log(`[${name}] nothing to close`);
      continue;
    }
    console.log(`[${name}] ${ixs.length} close ix(s), reclaim ~${reclaim / 1e9} SOL → ${rentCollector.toBase58()}`);
    const res = await sendWithSizing(connection, ixs, payer, [payerKp], {
      label: `rent-sweep/${name}`,
      dryRun: !LIVE,
      defaultUnits: 150_000,
    });
    if (res.signature) sig(`[${name}] sweep confirmed`, res.signature);
  }

  const balAfter = await connection.getBalance(payer, "confirmed");
  console.log(`payer balance after: ${balAfter / 1e9} SOL (delta ${(balAfter - bal) / 1e9})`);
  pub("rent sweep complete", payer.toBase58());
}

main().catch((e) => {
  console.error("rent sweep failed:", (e as Error).message);
  process.exit(1);
});
