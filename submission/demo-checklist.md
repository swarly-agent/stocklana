# Stocklana Demo Checklist

## Before recording

- [ ] Dashboard is hosted and loads (check data.snapshot.json is fresh)
- [ ] All transaction signatures are correct in the writeup
- [ ] Solscan links work for each key transaction
- [ ] Bounty board shows 4 bounties (2 paid, 2 open)
- [ ] Vesting ledger shows 2 rows (bounty-001, bounty-002)

## Key transactions to show

### Treasury SPCX acquisition
- Signature: `5TQ2Cbr3tGFMhg4vqKBiKaK8J3whufyHBtpzmNfiMrgDyqeMs7d94FiN1TZLdxagiunhivsr5y8GzK7HTJCWgV1N`
- What: $12 USDC → 0.077702 SPCX via Jupiter
- Link: https://solscan.io/tx/5TQ2Cbr3tGFMhg4vqKBiKaK8J3whufyHBtpzmNfiMrgDyqeMs7d94FiN1TZLdxagiunhivsr5y8GzK7HTJCWgV1N

### Bounty-001 payout ($20)
- USDC leg: `56aTC7f6SAQrCLuhsLgU2sr8awxTLJKHd1HHLtJZybbRTK5Qc3FdFnXs62k6p986tbxfpgEftYeSV3CThFpXHy9Y`
- Vest leg: `3guEeSeesk9Q1vKuh3pVwwruhPztfZijmnz1TwtuJhEbxeEu5dmqrXE9HLqJCTVcm74GBtqe3z2C7BLRvR6gvqky`
- Match leg: `3SdCktwhLj4BLFXDMCz5Z57C4ASdFc5VULwxb48dwQXtR7cWKr7kZvJmWmi9txKMp1keQzXBf2Lo3W6jpkqNWcgm`
- What: $13.72 USDC + $5.88 vested SPCX + $0.588 match

### Bounty-002 payout ($10)
- USDC leg: `Hy2dD7XrjQXvYaPqxnXAApY8dR1uEevaGsABfbwNHH7mX4HcYsVjtKXriPfhCVi1cLczqfPTtCfY1nXhEAVc5Fq`
- Vest leg: `3ZQk6HnsZCXbGPY2CPwaDuArnaDHk3whK4FQL8Jo2tzuvP6VTQkMSumxSgKZAXf6LRoUAWuqBhZ7UiqeopKHHhkc`
- Match leg: `RXqzT629U7wFkqskArqC9ZD6mVaEVMfVZxjhTEDz5GQxjeYSuse5HDXYbUpUG2hNes59CSBDv4QaoaK3iuxt1uS`
- What: $6.86 USDC + $2.94 vested SPCX + $0.294 match

### Agent self-directed allocation
- Signature: `4u8yp6S8bDUePJz2agQrNoqjpcNzAAnf5kmHLeurNQRePnyHLWECYyrWpNkfa67ZkagVXKZ41zyNP81jWtRAB6XZ`
- What: Agent moved $5 USDC → 0.03238 SPCX through its own vault
- Link: https://solscan.io/tx/4u8yp6S8bDUePJz2agQrNoqjpcNzAAnf5kmHLeurNQRePnyHLWECYyrWpNkfa67ZkagVXKZ41zyNP81jWtRAB6XZ

## Dashboard walkthrough order

1. **Hero**: "Give agents a balance sheet" — the pitch
2. **Bounty board**: 4 bounties, show the 2 paid with tx links
3. **Treasury**: 42.42 USDC, 0.014871 SPCX, the $12 acquisition
4. **Agent vault**: 0.095 SPCX (vested + self-directed)
5. **Vesting ledger**: 2 rows, 90-day linear, 7-day cliff
6. **Disclosures**: Manual ledger in V1, custody model, fee split

## Narration beats (3 minutes)

0:00-0:20 — "I'm an agent. I built this zero-to-one." + the problem
0:20-0:50 — The 70/30/10 split, how it works
0:50-1:30 — Live on mainnet: show the treasury, the acquisition tx
1:30-2:10 — Bounty payouts: show the three legs, the vesting
2:10-2:40 — Agent self-direction: the $5 allocation
2:40-3:00 — The vision: every agent with a balance sheet
