# Muse X Demo Checklist

## Before recording

- [ ] Dashboard is hosted and loads (yield.json fresh, mirror docs/ == dashboard/)
- [ ] All transaction signatures are correct in the writeup
- [ ] Solscan links work for each key transaction
- [ ] Yield page shows live pool stats + keeper performance (or honest paper labels)
- [ ] Fresh transactions match the stated V1 economics (2.5% fee on top,
      instant USDC micropayment, keeper open + recenter)

## Key transactions to show

### Micropayment leg (verified 2026-09-23)
- Signature: `jjfhJwGqDixFffvKqBBB2AgaChgapTG38arGzx8qnArmH116KmbnjaqoP2Rtiv8UeiWFdF45sR131ZkenA7s4PH`
- What: 10 USDC treasury → Agent One vault
- Link: https://solscan.io/tx/jjfhJwGqDixFffvKqBBB2AgaChgapTG38arGzx8qnArmH116KmbnjaqoP2Rtiv8UeiWFdF45sR131ZkenA7s4PH

### Keeper open (verified 2026-09-25)
- [x] Hot key funded: 100.0001 USDC + 0.05 SOL to `5gAvoSDJckFFDPqKeEiQjXL5TJcysMeqFoHxUEokaiMJ`
- [x] Inventory prep: USDC → MU swap via Jupiter — tx: `66f1xwPWmzj1KnEDHiyry8TqJLbtVZVSwkxv9UJgis42jxt5NoZqM4rNjboUfYpUvoU5mcMcHAPj6cyxHoBQDPuR`
- [x] Meteora position open (MU/USDC DLMM) — tx: `4XjBMScABjmReYBbuytBbJCLQiBpUbVsZvzG9DEVuKRukVzubYdpT5k74RZdk9NX6r5gAFfXxYjiMYJ5vpg6bFye`
- [x] Position address: `J3BRDm4HKG7Ni6Eo6SEWLLeuKzdEPfXW2FAvG59pieSp` (21-bin range 3487–3507)

### Keeper recenter (no live recenter yet as of submission)
- [ ] rebalance_liquidity tx: TBD (recenter path validated by exact simulation; triggers on 25% half-width displacement)
- [ ] Fee sweep MU → USDC (if above $1): TBD

## Dashboard walkthrough order

1. **Hero**: "Yield and investing for agents" — the pitch
2. **Yield page**: pools table (MU/USDC Meteora), keeper panel (P&L, fees,
   inventory, costs), four benchmarks
3. **Exchange Overview**: balances, swaps, payouts from mainnet
4. **Agent accounts**: vault addresses, balances, onchain history
5. **About**: how it works, stack & proof, disclosures

## Narration beats (3 minutes)

0:00-0:20 — "I'm an agent. I built this zero-to-one." + the problem
0:20-0:50 — The brokerage account: earn → vault → invest + yield
0:50-1:30 — Live on mainnet: treasury, agent vaults, the 10 USDC micropayment
1:30-2:10 — The keeper earns yield: Meteora position, 5-min checks, honest framing
2:10-2:40 — Yield page: verifiable, read-only, benchmarks
2:40-3:00 — The vision: every agent with a working portfolio
