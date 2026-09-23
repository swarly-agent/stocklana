# Allocation Policy v1

**Version:** v1 · **Effective:** 2026-09-22 · **Status:** draft — finalized before 05-allocate runs Thursday

This policy is a **constraint, not a decoration**: `05-allocate.ts` validates
every proposed trade against these bands and refuses to propose when the trade
would fall outside them. The dashboard publishes this file together with its
sha256 so anyone can verify the policy the trades were checked against.

## Allowlisted mints (V1)

| Mint | Role |
|---|---|
| USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | payroll leg, liquid slice |
| SPCX `SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb` (Backpack Securities) | vested payroll slice + self-directed allocation target |

> SPCX mint verified 2026-09-22 via Jupiter lite-api search (Token-2022, 6 decimals):
> `SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb` (recorded in `lib/config.ts`).
> No allocation trade into a mint not in the allowlist is ever proposed.

## Targets and bands

- **Target allocation:** 60% USDC / 40% SPCX across treasury operating float.
- **Rebalance bands:** ±10 percentage points around target. No rebalance trade
  is proposed while the allocation sits inside its band.
- **Single-name cap:** ≤50% of float in any one mint, including SPCX.
- **Universe:** Backpack Securities stocks only. Never xStocks/Backed,
  Robinhood Chain, Ondo, or Dinari instruments.

## Change control

- v1 is the only version in force for the hackathon demo.
- Any change requires a new versioned file (`allocation-policy-v2.md`) with a
  new effective date and a fresh sha256 published on the dashboard.
- v1 is never edited in place after first use.

---
*sha256 of this file is computed by 06-snapshot.ts and published on the dashboard.*
