// 09-rent-sweep-probe.ts — READ-ONLY probe: for each vault, read the multisig's
// configured rentCollector and scan transaction indices for unclosed
// Transaction/Proposal PDAs. Prints a close plan. Sends nothing.
import { PublicKey } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import fs from "node:fs";
import { getConnection } from "../lib/squads.js";
import { pub } from "../lib/safe-log.js";

const vaults = JSON.parse(fs.readFileSync("data/vaults.json", "utf8"));

async function main() {
  const connection = await getConnection();
  for (const [name, v] of Object.entries<any>(vaults)) {
    if (!v.multisigPda) continue;
    const multisigPda = new PublicKey(v.multisigPda);
    const info = await connection.getAccountInfo(multisigPda, "confirmed");
    if (!info) {
      console.log(`[${name}] multisig not found`);
      continue;
    }
    const [state] = multisig.accounts.multisigBeet.deserialize(info.data);
    const rentCollector = new PublicKey(state.rentCollector as Uint8Array);
    const txIndex = BigInt(state.transactionIndex as unknown as string);
    console.log(`[${name}] multisig=${v.multisigPda}`);
    console.log(`[${name}] rentCollector=${rentCollector.toBase58()} txIndex=${txIndex}`);
    const open: number[] = [];
    for (let i = 1n; i <= txIndex; i++) {
      const [txPda] = multisig.getTransactionPda({ multisigPda, index: i });
      const [propPda] = multisig.getProposalPda({ multisigPda, transactionIndex: i });
      const [txInfo, propInfo] = await Promise.all([
        connection.getAccountInfo(txPda, "confirmed"),
        connection.getAccountInfo(propPda, "confirmed"),
      ]);
      if (txInfo || propInfo) {
        open.push(Number(i));
        console.log(
          `  [${name}] index ${i}: txPDA=${txInfo ? txInfo.lamports : "closed"} propPDA=${propInfo ? propInfo.lamports : "closed"}`
        );
      }
    }
    if (!open.length) console.log(`  [${name}] no open PDAs`);
    pub(`[${name}] done`, multisigPda.toBase58());
  }
}

main().catch((e) => {
  console.error("probe failed:", (e as Error).message);
  process.exit(1);
});
