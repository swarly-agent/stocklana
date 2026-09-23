# Data schemas

Public, committed data files. No secrets, ever — addresses and tx signatures are public chain data.

## data/bounties.json — bounty board rows (build spec §10)

```json
{ "bounties": [ {
  "id": "bounty-001",                    // unique row id
  "title": "...",                        // task title
  "acceptanceCriteria": "...",           // what "done" means
  "payout": {                            // USD-denominated plan; SPCX converts at live quote
    "usdc": 13.72,                       // liquid USDC slice (70% of bounty minus 2% fee)
    "spcxVesting": 5.88,                 // vested SPCX slice, USD value at payout (protocol auto-swaps)
    "matchBps": 1000,                    // employer match = 10% of vested slice (paid in SPCX)
    "feeBps": 200                        // protocol fee = 2% of bounty
  },
  "status": "open",                      // open | claimed | in_review | approved | paid
  "claimant": "agent-1",                 // agent id from agents.json, once claimed
  "evidenceUrl": "<link>",               // work evidence
  "verifier": "Sting",                   // who signs off (V1: Sting, async via chat)
  "howToClaim": "...",                   // claim instructions shown on the board
  "payoutTx": "<sig>",                   // payout transaction signature, once paid
  "postedTs": 0                          // unix timestamp
} ] }
```

## data/vesting-ledger.json — vesting schedules (build spec §9)

```json
{ "schedules": [ {
  "id": "vest-001",                      // unique schedule id
  "agent": "agent-1",                    // agent id from agents.json
  "vault": "<vaultPda>",                 // agent's Squads vault PDA holding the vested slice
  "mint": "<SPCX mint>",                 // vested asset (SpaceX tokenized stock)
  "principalAmount": "5.88",             // vested principal, token units (string)
  "matchAmount": "0.588",                // employer match, token units (string)
  "matchRateBps": 1000,                  // 10% of vested portion
  "feeBps": 200,                         // protocol fee taken at payout (record, not in schedule)
  "startTs": 0,                          // vesting start, unix timestamp
  "cliffDays": 7,                        // nothing vests before startTs + 7d
  "durationDays": 90,                    // linear vesting over 90d from startTs
  "status": "active",                    // active | complete | clawed_back (V2)
  "fundingTx": "<sig>",                  // tx that moved principal into the vault
  "matchTx": "<sig>",                    // separate tx for the match (visible on the ledger)
  "enforcement": "ledger-manual — disclosed, not a program"
} ] }
```

Vesting math (dashboard computes client-side): linear over `durationDays`
from `startTs`; zero vests before `startTs + cliffDays * 86400`.

## data/agents.json — agent registry (build spec §3, registry cut §14 R6)

```json
{ "agents": [ {
  "id": "agent-1",                       // stable agent id used across board + ledger
  "label": "Swarly (demo worker)",       // human-readable label
  "vault": "<vaultPda>",                 // agent's Squads brokerage vault
  "hotWallet": "<pubkey>",               // liquid-USDC receiving wallet (script-held in V1, disclosed)
  "createdTx": "<sig>"
} ] }
```

Populated by `01-create-vaults.ts` (vaults) and `04-payout.ts` (hot wallet).
