/**
 * 09-econ-test.ts — the fresh full-economics test (2026-09-23 walkthrough, F3 decision).
 *
 *  $20 test bounty under the 50/50 economics:
 *    leg "usdc"   — 10 USDC treasury vault → Agent 1 vault (Squads vault tx)
 *    leg "stream" — 67,100 SPCX units (~$10 @ $149.03) into a Streamflow V2
 *                   stream: 1h lock (cliff, cliffAmount 0) + 1h linear vest,
 *                   non-cancelable, auto-withdrawal on, recipient = Agent 1 vault.
 *
 *  The Streamflow leg uses the V2 path (nonce → metadata PDA, NOT a keypair),
 *  so the only signer on the create instruction is the treasury vault PDA —
 *  executable as a Squads vault transaction. V1 would need an ephemeral
 *  metadata keypair signer and canNOT run through the vault.
 *
 *  COST WARNING: Streamflow charges the sender ~0.425 SOL for the auto-drip
 *  configuration (0.16 creation fee + 0.25 auto-claim prepay + ~0.015 rents),
 *  paid by the treasury vault. The stream leg REFUSES to run until the vault
 *  holds ~0.44 SOL — top up from Sting.
 *
 *  SAFETY: dry-run is the default. The real run needs --live AND --i-confirm
 *  (Sting's explicit sign-off — no unilateral moves). Balances are read LIVE
 *  onchain at run time; the script refuses to size anything from stale data.
 *
 *  Usage:
 *    npx tsx scripts/09-econ-test.ts --leg usdc [--live --i-confirm]
 *    npx tsx scripts/09-econ-test.ts --leg stream [--live --i-confirm]
 */

import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { SolanaStreamClient, getBN, deriveStreamMetadataPDA } from "@streamflow/stream";
import { MINTS } from "../lib/config.js";
import {
  TOKEN_2022,
  ataFor,
  getConnection,
  getTokenBalance,
  loadKeypair,
  squadsProposeApproveExecute,
} from "../lib/squads.js";
import { pub, sig } from "../lib/safe-log.js";

const DRY_RUN = !process.argv.includes("--live");
const CONFIRMED = process.argv.includes("--i-confirm");
const LEG = process.argv.find((a) => a.startsWith("--leg="))?.split("=")[1]
  ?? process.argv[process.argv.indexOf("--leg") + 1];

const TREASURY_MULTISIG = new PublicKey("4QBhBYPp8y6Mcw7UtycvG4ACuR6ThyMe97SEv87Wiy5m");
const TREASURY_VAULT = new PublicKey("Bjv8VJdAZqtYW3cz5nfNEnVZx2WwWMA1quqgPRGVQMTp");
const AGENT1_VAULT = new PublicKey("HkSofdPwKHq6cp5Ej36KaLCMHU15U518HwyJY2fNd9Yi");
const SPCX_MINT = new PublicKey("SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const STREAMFLOW_PROGRAM = new PublicKey("strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m");

// $20 test: 10 USDC liquid + ~$10 SPCX vested (@ $149.03 → 0.0671 SPCX)
const USDC_LEG_UNITS = 10_000_000n; // 10 USDC, 6dp
const SPCX_LEG_UNITS = 67_100n;     // 0.0671 SPCX, 6dp
const LOCK_SECONDS = 3600;          // 1h cliff (Sting, 2026-09-23 20:32 ET)
const VEST_SECONDS = 3600;          // 1h linear vest
// Streamflow V2 nonce: the @streamflow/stream SDK (13.4.0) has a serialization
// bug — it passes a Buffer where the layout expects u32, so the onchain nonce
// is ALWAYS 0 regardless of input. The metadata PDA must therefore be derived
// with nonce 0 (which is what the SDK's deriveStreamMetadataPDA does when
// passed 0). One stream per (sender, mint) — fine for the test.
const STREAM_NONCE = 0;
// The Streamflow program rejects start_time <= now (InvalidTimestamps), so
// start the stream 2 minutes in the future.
const START_DELAY_SECONDS = 120;
// amountPerPeriod uses ceiling division (SDK's computeAmountPerPeriod):
// ceil(67100/3600) = 19. The program caps released at deposited, so all
// 67,100 units release exactly by end (floor division would strand 2,300).
const SPCX_PER_PERIOD = (SPCX_LEG_UNITS + BigInt(VEST_SECONDS) - 1n) / BigInt(VEST_SECONDS);
// Streamflow creation fee + rent, paid by the sender (treasury vault).
// Measured 2026-09-23: 0.16 SOL creation fee (fee-oracle withdrawor default;
// the SDK's 0.09 fallback is stale) + 0.25 SOL auto-claim prepay when
// automaticWithdrawal=true (sender pays scheduled transfer fees upfront, per
// Streamflow docs) + ~0.015 SOL account rents. ≈ 0.425 SOL total.
const STREAM_COST_LAMPORTS = 440_000_000n; // ~0.44 SOL ceiling

async function ataExists(connection: any, ata: PublicKey): Promise<boolean> {
  const info = await connection.getAccountInfo(ata, "confirmed");
  return info !== null;
}

async function legUsdc(connection: any, memberKp: Keypair, blockhash: string) {
  const treasuryUsdcAta = ataFor(USDC_MINT, TREASURY_VAULT, TOKEN_PROGRAM_ID);
  const agentUsdcAta = ataFor(USDC_MINT, AGENT1_VAULT, TOKEN_PROGRAM_ID);

  const bal = await getTokenBalance(connection, treasuryUsdcAta);
  console.log(`treasury USDC: ${bal === null ? "NO ATA" : Number(bal) / 1e6}`);
  if (bal === null || bal < USDC_LEG_UNITS) {
    throw new Error(`treasury USDC insufficient for the 10 USDC leg (live balance read)`);
  }

  const ixs: TransactionInstruction[] = [];
  if (!(await ataExists(connection, agentUsdcAta))) {
    console.log("agent1 USDC ATA missing — creating (payer: treasury vault)");
    ixs.push(
      createAssociatedTokenAccountInstruction(
        TREASURY_VAULT, agentUsdcAta, AGENT1_VAULT, USDC_MINT, TOKEN_PROGRAM_ID,
      ),
    );
  }
  ixs.push(
    createTransferInstruction(treasuryUsdcAta, agentUsdcAta, TREASURY_VAULT, USDC_LEG_UNITS, [], TOKEN_PROGRAM_ID),
  );
  console.log(`→ 10 USDC treasury → agent1 vault`);

  const inner = new TransactionMessage({ payerKey: TREASURY_VAULT, recentBlockhash: blockhash, instructions: ixs });
  const r = await squadsProposeApproveExecute({
    connection, multisigPda: TREASURY_MULTISIG, vaultPda: TREASURY_VAULT,
    memberKp, inner, lutAccounts: [], label: "09-econ-test/usdc", dryRun: DRY_RUN,
  });
  if (r.executeSignature) sig("09-econ-test/usdc execute sig", r.executeSignature);
  return r;
}

async function legStream(connection: any, memberKp: Keypair, blockhash: string) {
  // Funding gate: the vault pays ~0.425 SOL (0.16 creation fee + 0.25
  // auto-claim prepay + rents) for the auto-drip configuration.
  const vaultSol = BigInt(await connection.getBalance(TREASURY_VAULT, "confirmed"));
  console.log(`treasury SOL: ${Number(vaultSol) / 1e9}`);
  if (vaultSol < STREAM_COST_LAMPORTS) {
    throw new Error(
      `treasury SOL ${Number(vaultSol) / 1e9} < ~0.44 needed for Streamflow creation — ` +
      `top up ~0.32 SOL to the treasury vault first (Sting)`,
    );
  }

  const treasurySpcxAta = ataFor(SPCX_MINT, TREASURY_VAULT, TOKEN_2022);
  const bal = await getTokenBalance(connection, treasurySpcxAta);
  console.log(`treasury SPCX: ${bal === null ? "NO ATA" : Number(bal) / 1e6}`);
  if (bal === null || bal < SPCX_LEG_UNITS) {
    throw new Error(`treasury SPCX insufficient for the vested leg (live balance read)`);
  }

  const client = new SolanaStreamClient(connection.rpcEndpoint);
  const now = Math.floor(Date.now() / 1000);
  const start = now + START_DELAY_SECONDS; // program requires start > now
  const metadataPda = deriveStreamMetadataPDA(STREAMFLOW_PROGRAM, SPCX_MINT, TREASURY_VAULT, STREAM_NONCE);
  pub("stream metadata PDA (stream id)", metadataPda.toBase58());

  const params = {
    recipient: AGENT1_VAULT.toBase58(),
    tokenId: SPCX_MINT.toBase58(),
    start,
    amount: getBN(Number(SPCX_LEG_UNITS), 0),
    period: 1,
    cliff: start + LOCK_SECONDS,
    cliffAmount: getBN(0, 0),
    amountPerPeriod: getBN(Number(SPCX_PER_PERIOD), 0),
    name: "MuseX econ test — agent1 vested leg",
    canTopup: false,
    cancelableBySender: false,
    cancelableByRecipient: false,
    transferableBySender: false,
    transferableByRecipient: false,
    automaticWithdrawal: true,
    withdrawalFrequency: 600,
    nonce: STREAM_NONCE,
  };
  const { ixs } = await client.prepareCreateInstructions(params, {
    sender: { publicKey: TREASURY_VAULT },
    isNative: false,
  } as any);
  if (!ixs || ixs.length === 0) throw new Error("streamflow returned no instructions");
  // V2 assertion: metadata must NOT be a signer (PDA path). If the SDK fell
  // back to V1 (ephemeral keypair), the vault cannot sign — abort.
  const metaIx = ixs.find((ix: TransactionInstruction) => ix.programId.equals(STREAMFLOW_PROGRAM));
  const metaKey = metaIx?.keys.find((k) => k.pubkey.equals(metadataPda));
  if (!metaKey || metaKey.isSigner) {
    throw new Error("streamflow did not take the V2 PDA path — refusing (vault cannot sign a keypair metadata)");
  }
  console.log(`→ stream: ${Number(SPCX_LEG_UNITS) / 1e6} SPCX → agent1, 1h lock + 1h vest, non-cancelable, auto-drip`);

  const inner = new TransactionMessage({ payerKey: TREASURY_VAULT, recentBlockhash: blockhash, instructions: ixs as TransactionInstruction[] });
  const r = await squadsProposeApproveExecute({
    connection, multisigPda: TREASURY_MULTISIG, vaultPda: TREASURY_VAULT,
    memberKp, inner, lutAccounts: [], label: "09-econ-test/stream", dryRun: DRY_RUN,
  });
  if (r.executeSignature) {
    sig("09-econ-test/stream execute sig", r.executeSignature);
    pub("stream metadata (verify)", metadataPda.toBase58());
  }
  return r;
}

async function main(): Promise<void> {
  if (!["usdc", "stream"].includes(LEG)) throw new Error("pass --leg usdc|stream");
  if (!DRY_RUN && !CONFIRMED) throw new Error("refusing live run without --i-confirm (Sting's sign-off)");
  console.log(`09-econ-test leg=${LEG} — ${DRY_RUN ? "DRY-RUN (nothing will be sent)" : "LIVE RUN"}`);

  const connection = await getConnection();
  const memberKp = loadKeypair("squads-member-keypair.json");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const r = LEG === "usdc"
    ? await legUsdc(connection, memberKp, blockhash)
    : await legStream(connection, memberKp, blockhash);
  console.log(JSON.stringify({ dryRun: DRY_RUN, leg: LEG, executeSig: r.executeSignature }, null, 2));
}

main().catch((e) => {
  console.error(`09-econ-test FAILED: ${(e as Error).message}`);
  process.exit(1);
});
