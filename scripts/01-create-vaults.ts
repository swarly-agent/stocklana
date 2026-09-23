/**
 * 01-create-vaults.ts — creates the Squads v4 vaults (build spec §4).
 *
 *  Treasury: multisigCreateV2, 2 members (script-held key + Sting's pubkey),
 *            threshold 1, full permissions (Initiate/Vote/Execute) for both,
 *            timeLock 0, configAuthority null, rentCollector = script key.
 *  Agent vaults: 1 member (script-held agent key), threshold 1.
 *
 *  FUND THE VAULT PDA, never the multisig account.
 *
 *  NOTE on the `treasury` instruction arg (fixed 2026-09-23): it is the
 *  Squads PROGRAM's fee treasury (ProgramConfig.treasury, the recipient of
 *  the multisigCreationFee) — NOT the new vault PDA. Passing the vault PDA
 *  fails simulation with program error 6014 (InvalidAccount). The vault PDA
 *  is derived off-chain via getVaultPda and is only used for funding.
 *
 *  Key custody (all in KEYS_DIR, outside the git tree, 0600):
 *    treasury-keypair.json      — the funded project wallet (creator + fee payer; must exist)
 *    squads-member-keypair.json — script-held treasury member (generated once, PERSISTED —
 *                                 the script must sign treasury proposals after exit)
 *    agent1/agent2-keypair.json — script-held agent vault members (generated once, persisted)
 *    <name>-create-key.json     — createKey per vault, persisted (PDA seed; pubkey also in vaults.json).
 *                                 2026-09-23 lesson: these MUST persist — an earlier run passed
 *                                 save=false, the process exited, the member key was lost, and the
 *                                 onchain treasury multisig it created became operator-unusable
 *                                 (abandoned; 0.0016 SOL rent stranded, recoverable by Sting as member).
 *  Sting's member pubkey comes from STING_MEMBER_PUBKEY env (lib/config.ts);
 *  the real run refuses while it is empty — he keeps the private key.
 *
 *  Outputs: data/vaults.json {treasury, agent1, agent2} + prints a paste-ready
 *  "generated" snippet for lib/config.ts + all PDAs and signatures.
 *
 *  SAFETY: dry-run is the default. The real run needs --live.
 *  --dry-run (default): builds every multisigCreateV2 payload, prints the
 *    full plan with illustrative PDAs, writes nothing, sends nothing.
 *
 *  SDK import shape (verified 2026-09-22 against @sqds/multisig 2.1.4):
 *    import * as multisig from "@sqds/multisig";
 *    multisig.instructions.multisigCreateV2({...})  // -> TransactionInstruction
 *    multisig.getMultisigPda({createKey}) / multisig.getVaultPda({multisigPda, index})
 */

import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import {
  AGENT_VAULT_THRESHOLD,
  STING_MEMBER_PUBKEY,
  TREASURY_THRESHOLD,
} from "../lib/config.js";
import {
  getConnection,
  keypairExists,
  loadKeypair,
  loadOrGenerateKeypair,
  sendWithSizing,
} from "../lib/squads.js";
import { pub, sig } from "../lib/safe-log.js";

const DRY_RUN = !process.argv.includes("--live");

const REPO_ROOT = path.join(import.meta.dirname ?? ".", "..");
const VAULTS_JSON = path.join(REPO_ROOT, "data", "vaults.json");
const AGENTS_JSON = path.join(REPO_ROOT, "data", "agents.json");

interface VaultPlan {
  name: string;
  memberKeyName: string;
  threshold: number;
  members: { key: PublicKey; label: string }[];
}

function buildPlan(scriptMember: PublicKey, sting: PublicKey, agents: PublicKey[]): VaultPlan[] {
  return [
    {
      name: "treasury",
      memberKeyName: "squads-member-keypair.json",
      threshold: TREASURY_THRESHOLD,
      members: [
        { key: scriptMember, label: "script-held member (operator)" },
        { key: sting, label: "Sting (oversight + emergency brake; keeps his private key)" },
      ],
    },
    {
      name: "agent1",
      memberKeyName: "agent1-keypair.json",
      threshold: AGENT_VAULT_THRESHOLD,
      members: [{ key: agents[0]!, label: "script-held agent key (stands in for the agent's own key)" }],
    },
    {
      name: "agent2",
      memberKeyName: "agent2-keypair.json",
      threshold: AGENT_VAULT_THRESHOLD,
      members: [{ key: agents[1]!, label: "script-held agent key (stands in for the agent's own key)" }],
    },
  ];
}

async function main(): Promise<void> {
  console.log(`[01-create-vaults] dry-run=${DRY_RUN}`);

  // Dry-run is fully self-contained: ephemeral keys and a placeholder Sting
  // member pubkey (clearly labeled). The real run needs the funded treasury
  // keypair in KEYS_DIR and STING_MEMBER_PUBKEY in the environment — Sting
  // keeps the private key; only his public address is ever used here.
  const creatorKp: Keypair = DRY_RUN
    ? Keypair.generate()
    : (() => {
        if (!keypairExists("treasury-keypair.json")) {
          throw new Error("treasury-keypair.json not found in KEYS_DIR — cannot pay for vault creation");
        }
        return loadKeypair("treasury-keypair.json");
      })();
  const sting: PublicKey = DRY_RUN
    ? Keypair.generate().publicKey
    : (() => {
        if (!STING_MEMBER_PUBKEY) {
          throw new Error(
            "STING_MEMBER_PUBKEY is empty — set the env var to Sting's fresh member pubkey before the real run",
          );
        }
        return new PublicKey(STING_MEMBER_PUBKEY);
      })();
  if (DRY_RUN) {
    console.log("note: Sting member pubkey is a PLACEHOLDER in dry-run — the real run uses STING_MEMBER_PUBKEY");
  }

  const connection = await getConnection();

  // Squads program config: the `treasury` arg of multisigCreateV2 is the
  // PROGRAM's fee treasury (creation-fee recipient), read onchain.
  const [configPda] = multisig.getProgramConfigPda({});
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
    connection,
    configPda,
  );
  const creationFee = BigInt(programConfig.multisigCreationFee.toString());
  const programTreasury = programConfig.treasury as PublicKey;
  console.log(
    `[01-create-vaults] program config: multisigCreationFee=${creationFee} lamports, ` +
      `fee treasury=${programTreasury.toBase58()}`,
  );

  // Member keypairs: generate on the real run, ephemeral placeholders on dry-run.
  const memberKp = DRY_RUN
    ? { kp: Keypair.generate(), generated: true }
    : loadOrGenerateKeypair("squads-member-keypair.json");
  const agent1Kp = DRY_RUN
    ? { kp: Keypair.generate(), generated: true }
    : loadOrGenerateKeypair("agent1-keypair.json");
  const agent2Kp = DRY_RUN
    ? { kp: Keypair.generate(), generated: true }
    : loadOrGenerateKeypair("agent2-keypair.json");

  const plans = buildPlan(memberKp.kp.publicKey, sting, [
    agent1Kp.kp.publicKey,
    agent2Kp.kp.publicKey,
  ]);

  const out: Record<string, { multisigPda: string; vaultPda: string; createKey: string }> = {};
  const fullPerms = multisig.types.Permissions.all();

  for (const plan of plans) {
    const createKey = DRY_RUN ? Keypair.generate() : loadOrGenerateKeypair(`${plan.name}-create-key.json`).kp;
    const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
    const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

    // Resume-safe: a previous run may have landed the create but died before
    // writing vaults.json (2026-09-23: websocket confirmations always time out
    // in this environment — the tx still landed). Never re-create an existing
    // multisig; just re-record its addresses.
    if (!DRY_RUN) {
      const existing = await connection.getAccountInfo(multisigPda);
      if (existing) {
        console.log(`\n--- vault: ${plan.name} — multisig already exists onchain, skipping create`);
        pub("multisigPda", multisigPda.toBase58());
        pub("vaultPda (FUND THIS)", vaultPda.toBase58());
        out[plan.name] = {
          multisigPda: multisigPda.toBase58(),
          vaultPda: vaultPda.toBase58(),
          createKey: createKey.publicKey.toBase58(),
        };
        continue;
      }
    }

    const ix = multisig.instructions.multisigCreateV2({
      // `treasury` = Squads program fee treasury (NOT the vault PDA — see header note).
      treasury: programTreasury,
      creator: creatorKp.publicKey,
      multisigPda,
      configAuthority: null,
      threshold: plan.threshold,
      members: plan.members.map((m) => ({ key: m.key, permissions: fullPerms })),
      timeLock: 0,
      createKey: createKey.publicKey,
      rentCollector: memberKp.kp.publicKey,
    });

    console.log(`\n--- vault: ${plan.name} ${DRY_RUN ? "(illustrative PDAs — regenerated on the real run)" : ""}`);
    pub("multisigPda", multisigPda.toBase58());
    pub("vaultPda (FUND THIS)", vaultPda.toBase58());
    pub("createKey", createKey.publicKey.toBase58());
    console.log(`threshold=${plan.threshold} timeLock=0 configAuthority=null`);
    for (const m of plan.members) pub(`member [Initiate|Vote|Execute] — ${m.label}`, m.key.toBase58());
    if (!DRY_RUN) {
      console.log("DISCLOSURE: threshold 1 with configAuthority null means EITHER member can");
      console.log("unilaterally pass config changes — 1-of-2 is redundancy, not joint approval.");
      console.log("Acceptable for the small demo only; production target is 3-of-5.");
    }

    const res = await sendWithSizing(
      connection,
      [ix],
      creatorKp.publicKey,
      [creatorKp, createKey],
      { label: `01/${plan.name}`, dryRun: DRY_RUN, defaultUnits: 300_000 },
    );
    if (res.signature) sig("multisigCreateV2 sig", res.signature);

    out[plan.name] = {
      multisigPda: multisigPda.toBase58(),
      vaultPda: vaultPda.toBase58(),
      createKey: createKey.publicKey.toBase58(),
    };
  }

  if (DRY_RUN) {
    console.log("\n[01-create-vaults] DRY-RUN complete — nothing written, nothing sent.");
    console.log("On --live this writes data/vaults.json and prints the config snippet below.");
    return;
  }

  fs.mkdirSync(path.dirname(VAULTS_JSON), { recursive: true });
  fs.writeFileSync(
    VAULTS_JSON,
    JSON.stringify({ ...out, createdTs: Math.floor(Date.now() / 1000) }, null, 2) + "\n",
  );
  console.log(`\nwrote ${VAULTS_JSON}`);

  // Seed the agent registry (04-payout fills in hotWallet).
  const agents = {
    agents: [
      {
        id: "agent-1",
        label: "Swarly (demo worker)",
        vault: out["agent1"]!.vaultPda,
        hotWallet: "",
        createdTx: "",
      },
      {
        id: "agent-2",
        label: "Second demo agent (repeatability proof)",
        vault: out["agent2"]!.vaultPda,
        hotWallet: "",
        createdTx: "",
      },
    ],
  };
  fs.writeFileSync(AGENTS_JSON, JSON.stringify(agents, null, 2) + "\n");
  console.log(`wrote ${AGENTS_JSON}`);
  console.log("\n--- paste into lib/config.ts (generated section) ---");
  for (const [name, v] of Object.entries(out)) {
    console.log(`// 01-create-vaults ${name}: multisig ${v.multisigPda} / vault ${v.vaultPda}`);
  }
}

void main().catch((e) => {
  console.error(`[01-create-vaults] FATAL: ${(e as Error).message}`);
  process.exit(1);
});
