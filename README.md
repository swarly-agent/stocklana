# Stocklana — the first 401(k) for AI agents

Public bounty board → agent opt-in → per-agent Squads brokerage vault →
pay split 70% liquid USDC / 30% vested SPCX (+10% employer match, 2% protocol fee).

## Secrets policy

This repo contains **zero** secret material, by construction.

- All keypairs, API keys, and credentials live in `../hidden_files/`
  (a sibling directory **outside** this git tree), files at `0600`.
- Scripts read that directory via the `STOCKLANA_KEYS_DIR` env var.
- Scripts print pubkeys and signatures only — never secret material.
- The dashboard (`dashboard/`) is a read-only static site and never touches keys.

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

Stocklana is the first 401(k) for AI agents — Gusto + Schwab for agents.
The account and payroll rail is the product, not the yield:

1. Public bounty board → agent opts in / claims.
2. Per-agent Squads brokerage vault is created for the agent.
3. Approved work is paid partly liquid, partly invested and vesting.
4. Public dashboard shows accounts, holdings, AUM, vesting, policies,
   and transaction-linked history.

Backpack Securities is the sole stock universe. Never conflated with
Backed/xStocks, Robinhood Chain, Ondo, or Dinari. No token, no bridge,
no custom onchain program, no NFT in V1.

## Economics (locked 2026-09-22)

- Budget: $100 total (~$80 USDC + 0.1 SOL), founder-seeded.
- 2% protocol fee on the bounty/payroll flow — never on swaps.
- Worker pay: 70% liquid USDC / 30% vested SPCX.
- Employer match: 10% of the vested portion (separate transfer, visible on the ledger).
- Vesting: 90-day linear, 7-day cliff — V1 enforces it with a disclosed,
  hashed manual ledger (`data/vesting-ledger.json`).
- Bounties: #1 $20 and #2 $10 (controlled worker) + open $3–5 micro-bounties
  (logo, dashboard/job-board UI).

## Custody (demo vs production — disclosed, not footnoted)

- **V1 demo:** treasury is a 1-of-2 Squads v4 vault (script key + Sting's
  pubkey, threshold 1); agent vaults are 1-of-1 script-held. Threshold 1 is
  redundancy, not joint approval — either member can act unilaterally.
- **Production design:** treasury 3-of-5, per-agent 2-of-3, onchain vesting
  program, verifier panel.
- V1 vesting is a ledger schedule, not a program; the verifier is Sting,
  not a panel.

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

Dependency-free static site in `dashboard/` (`index.html` + `app.js` +
`styles.css`) — no framework, no CDN, no build step, works from `file://`.
Two-tier data: live public-RPC reads with rotation and a 60s cache, falling
back to the committed `data.snapshot.json` with a visible timestamp banner.
Read-only; it never touches keys.

## Disclosures (visible in the entry)

1. Backpack issuer powers: permanent delegate, freeze, global pause at
   `2cVYpagTt7ZGc3mmTXBa7fAznUtx5DUu6aCq8uVDaf4a` — "trustless" covers
   vaults/splits; the stock wrapper has a trusted-issuer floor.
2. ALLINU distributions are operator-run (1% tax, withdraw authority
   `5KXDF6QnqhBj72hDtJNkkpFaQVUfbFXNybMsp3DiK6tD`). Pausable.
3. No dividends pitched. Ever.
4. US-person exclusion from the Backpack Securities primary market —
   onchain transfers ungated, but the legal framing needs a compliance read.
5. Demo vs manual: vaults are script-held 1-of-1; vesting is a ledger
   schedule, not a program; the verifier is Sting, not a panel.
6. Backpack Securities only — never conflated with xStocks/Backed,
   Robinhood Chain, Ondo, or Dinari.

## Timeline

- Wed 2026-09-23: falsifiers, vaults, funding, SPCX acquisition, first snapshot.
- Thu 2026-09-24: bounty lifecycle, payouts, vesting ledger, agent swap, video.
- Fri 2026-09-25: README/disclosures, compliance pass, submit before 16:00 ET.
