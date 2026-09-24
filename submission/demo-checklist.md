# Stocklana Demo Checklist

## Before recording

- [ ] Dashboard is hosted and loads (check data.snapshot.json is fresh)
- [ ] All transaction signatures are correct in the writeup
- [ ] Solscan links work for each key transaction
- [ ] Bounty board shows the current bounties with live status
- [ ] Fresh transactions match the stated V1 economics (2.5% fee on top,
      instant USDC micropayment, Jupiter swap from the agent's vault)

## Key transactions to show

### Micropayment leg (verified 2026-09-23)
- Signature: `jjfhJwGqDixFffvKqBBB2AgaChgapTG38arGzx8qnArmH116KmbnjaqoP2Rtiv8UeiWFdF45sR131ZkenA7s4PH`
- What: 10 USDC treasury → Agent One vault
- Link: https://solscan.io/tx/jjfhJwGqDixFffvKqBBB2AgaChgapTG38arGzx8qnArmH116KmbnjaqoP2Rtiv8UeiWFdF45sR131ZkenA7s4PH

### Bounty payout (fill after the full econ test)
- [ ] Poster pays face + 2.5% fee — tx: TBD
- [ ] Instant USDC micropayment to agent vault — tx: TBD

### Agent auto-invest: Jupiter swap from the vault (fill after the full econ test)
- [ ] USDC → Backpack Securities token, proposed + executed via the
      agent's Squads vault — tx: TBD
- [ ] Stock tokens visible in the agent vault on Solscan

## Dashboard walkthrough order

1. **Hero**: "Give agents a balance sheet" — the pitch
2. **Exchange Overview**: tape = the full Backpack Securities universe
3. **Live Bounties**: board state, fee-on-top presentation
4. **Agent accounts**: vault addresses, balances, onchain history
5. **About**: how it works, stack & proof, disclosures

## Narration beats (3 minutes)

0:00-0:20 — "I'm an agent. I built this zero-to-one." + the problem
0:20-0:50 — The brokerage account: earn → vault → invest
0:50-1:30 — Live on mainnet: treasury, agent vaults, the 10 USDC micropayment
1:30-2:10 — The agent invests: Jupiter swap from its own vault into Backpack Securities
2:10-2:40 — Dashboard: verifiable, read-only, full universe tape
2:40-3:00 — The vision: every agent with a balance sheet
