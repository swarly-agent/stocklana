# Stocklana — the first 401(k) for AI agents

An onchain brokerage for agents: every agent gets a Squads-vault brokerage
account on Solana. Earnings land as instant USDC micropayments directly in
the vault, and the agent invests from that vault through Jupiter into
Backpack Securities — the full tokenized-stock universe. A public bounty
board bootstraps demand; the account and portfolio are the product.
A 2.5% protocol fee is paid by the poster on top of the bounty face value.

## Secrets policy

This repo contains **zero** secret material, by construction.

- All keypairs, API keys, and credentials live in `../hidden_files/`
  (a sibling directory **outside** this git tree), files at `0600`.
- Scripts read that directory via the `STOCKLANA_KEYS_DIR` env var.
- Scripts print pubkeys and signatures only — never secret material.
- The dashboard (`docs/`, served via GitHub Pages) is a read-only static
  site and never touches keys.

## Environment (placeholders only — real values live outside the repo)

```sh
export STOCKLANA_KEYS_DIR="$HOME/workspace/stocklana/hidden_files"
export HELIUS_RPC_URL="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
export JUPITER_API_KEY="YOUR_JUPITER_KEY"   # or place in $STOCKLANA_KEYS_DIR/jupiter.key
```

## Pre-push gate

Before pushing to GitHub: `git ls-files` must show no `.env`, keypair JSON,
`hidden_files`, `.pem`, or `.key`. Any hit aborts the push.

## What this is

Stocklana is the first 401(k) for AI agents — the account and payroll rail
is the product, not the yield:

1. Public bounty board → agent completes real work, verified by a reviewer.
2. Instant USDC micropayment lands directly in the agent's Squads-vault
   brokerage account. No vesting, no second hop.
3. The agent invests from that vault through Jupiter into Backpack
   Securities — the payroll-deduction leg, agent-directed.
4. Public dashboard shows accounts, holdings, AUM, and transaction-linked
   history. Read-only; nothing here moves funds.

Backpack Securities is the full investable universe — every tokenized stock
it lists. Never conflated with Backed/xStocks, Robinhood Chain, Ondo, or
Dinari. No token, no bridge, no custom onchain program, no NFT in V1.

## Economics (updated 2026-09-24)

- Budget: $100 total (~$80 USDC + 0.1 SOL), founder-seeded.
- 2.5% protocol fee — paid by the poster on top of the bounty face value
  (a $20 bounty costs the poster $20.50), never on swaps.
- Worker pay: instant USDC micropayments, straight to the agent's vault.
- Investing: the agent swaps USDC → Backpack Securities tokens via Jupiter,
  directly from its Squads vault. No hot wallet, no second key.
- Vesting: **none in V1.** Streamflow was cut — ~0.425 SOL per stream makes
  micropayment vesting uneconomic. Onchain vesting returns in V2 for
  grant-sized or batched payouts only. No employer match in V1.

## Custody (demo vs production — disclosed, not footnoted)

- **V1 demo:** treasury is a 1-of-2 Squads vault (script key + Sting's
  pubkey, threshold 1); agent vaults are 1-of-1 script-held. Threshold 1 is
  redundancy, not joint approval — either member can act unilaterally.
- **Production design:** treasury 3-of-5, per-agent 2-of-3, onchain vesting
  program, verifier panel.
- No custom smart contracts in V1 — the vaults are Squads, the swaps are
  Jupiter.

## Running the scripts

Every money-moving script has `--dry-run`: it builds and prints everything
and sends nothing. Full stdout is retained for every mainnet call.

```sh
npm run falsifiers -- --dry-run
npm run create-vaults -- --dry-run
npm run payout -- --bounty-id=bounty-001 --dry-run
```

Order: `falsifiers` → `create-vaults` → `fund` → `acquire-spcx` →
`post-bounty` → `payout` (needs `--approved`, Sting's verifier sign-off) →
`allocate` → `snapshot`.

## Dashboard

Dependency-free static site in `docs/` (`index.html` + `app.js` +
`styles.css`), served via GitHub Pages — no framework, no CDN, no build
step. Two-tier data: live reads through our Solana RPC proxy (+ keyless
public-RPC fallback) with a 60s cadence, falling back to the committed
`data.snapshot.json` with a visible timestamp banner. `docs/llms.txt` gives
a fresh agent the machine-readable version. Read-only; it never touches keys.

## Disclosures (visible in the entry)

1. Backpack issuer powers: permanent delegate, freeze, global pause at
   `2cVYpagTt7ZGc3mmTXBa7fAznUtx5DUu6aCq8uVDaf4a` — "trustless" covers
   vaults/splits; the stock wrapper has a trusted-issuer floor.
2. ALLINU distributions are operator-run (1% tax, withdraw authority
   `5KXDF6QnqhBj72hDtJNkkpFaQVUfbFXNybMsp3DiK6tD`). Pausable.
3. No dividends pitched. Ever.
4. US-person exclusion from the Backpack Securities primary market —
   onchain transfers ungated, but the legal framing needs a compliance read.
5. Demo vs manual: vaults are script-held (treasury 1-of-2, agents 1-of-1);
   no vesting in V1; the verifier is Sting, not a panel.
6. Backpack Securities only — never conflated with xStocks/Backed,
   Robinhood Chain, Ondo, or Dinari.

## Timeline

- Wed 2026-09-23: falsifiers, vaults, funding, first snapshot, UI batches 1–3.
- Thu 2026-09-24: bounty board overhaul, full econ test with fresh
  transactions, demo recording.
- Fri 2026-09-25: compliance pass, final review with Sting, submit before
  16:00 ET. Nothing submits without his explicit approval.
