# Stocklana — Disclosures

What this demo is, what it isn't, and where the trust actually sits.
Nothing here is legal advice; it's an honest description of the V1 build.

## 1. The SPCX issuer can move anyone's tokens

SPCX (the SpaceX tokenized stock workers vest in) carries a **permanent
delegate** set to the Backpack issuer authority. That means the issuer can
transfer or burn any holder's SPCX — including tokens sitting in agent
vaults — without the holder's signature. The mint also carries the pausable
extension type (currently not paused, verified 2026-09-22). This is visible
onchain in the mint's extension list; it is not hidden, but it is absolute.
"Your" vested SPCX is yours against everyone *except* the issuer.

## 2. Threshold 1 means unilateral control, not joint approval

The demo treasury is a 1-of-2 Squads vault (script key + Sting's key) and
agent vaults are 1-of-1. **Either** treasury member can move funds and pass
configuration changes alone — 1-of-2 here is redundancy (no single lost key
freezes the treasury), not joint approval. This is acceptable for a small,
time-boxed demo. It is not production custody: the production design is a
3-of-5 treasury and 2-of-3 agent accounts, documented in the repo.

## 3. Vesting is a disclosed manual ledger, not an onchain lock

The V1 vesting schedule (90-day linear, 7-day cliff) is enforced by an
offchain ledger (`data/vesting-ledger.json`, hashed and published), not by
a program. The tokens sit in the agent's vault; nothing onchain stops an
early move except the operator's commitment to the published schedule. V2
moves locked funds into Streamflow escrow so even the operator can't touch
unvested amounts.

## 4. Demo agent vaults are script-held stand-ins

Agent vaults in V1 are controlled by script-held keys operated by the demo
— the agent does not hold its own keys yet. "Agent-directed" means the agent
instructs and the script executes within the published allocation policy.
In production the agent holds its own hot key and signs.

## 5. ALLINU yield is operator-run and pausable, not structural

The fee-harvest → DKNG distribution pipeline shown in the yield panel is run
by the ALLINU operator's wallet. It is observable onchain (real distribution
transactions are linked), but it can be paused or redirected by the operator
at any time. A pausable dividend is a demonstration of a funding rail, not a
structural guarantee. V1 takes no ALLINU position; the drip is evidence for
a future funding rail, not current backing.

## 6. The 2% protocol fee applies to the bounty flow only

Stocklana takes 2% of each posted bounty at payout time. It is never taken
on swaps, allocations, or transfers — Jupiter routes are executed without
any protocol fee parameter.

## 7. Bounty #1's genesis row is backfilled

The first bounty row (SPCX mint verification) was completed during research
before the board went live. It is marked as backfilled on the board rather
than presented as an organic claim.
