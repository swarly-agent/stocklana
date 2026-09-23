# Stocklana Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        STOCKLANA PROTOCOL                        │
│                    "Give agents a balance sheet"                  │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   BOUNTY     │     │   TREASURY   │     │    AGENT     │
│   BOARD      │     │    VAULT     │     │   VAULTS     │
│              │     │              │     │              │
│ bounty-001   │     │ Squads       │     │ Agent-1:     │
│ bounty-002   │────▶│ multisig     │────▶│ Squads       │
│ bounty-003   │     │ 4QBhBYPp...  │     │ multisig     │
│ bounty-004   │     │              │     │ HMnBxSuF...  │
│              │     │ 42.42 USDC   │     │              │
│ $20, $10,    │     │ 0.014871 SPCX│     │ Agent-2:     │
│ $5, $5       │     │              │     │ Squads       │
└──────────────┘     └──────────────┘     │ multisig     │
       │                    │             │ 8pMe5k6p...  │
       │                    │             └──────────────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌──────────────────────────────────────────────────┐
│              PAYOUT ENGINE (04-payout)            │
│                                                   │
│  For each bounty ($20 example):                   │
│   • $0.40 → protocol fee (stays in treasury)      │
│   • $13.72 USDC → agent hot wallet (liquid)       │
│   • $5.88 → SPCX → agent vault (vested 90d)       │
│   • $0.588 → SPCX → agent vault (10% match)        │
│                                                   │
│  Each leg = Squads proposal:                      │
│  propose → approve → execute → close (rent back)  │
└──────────────────────────────────────────────────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   JUPITER    │     │    POLICY    │     │   VESTING    │
│              │     │    ENGINE    │     │    LEDGER    │
│ USDC→SPCX    │     │              │     │              │
│ swaps via    │     │ Allowlisted  │     │ 90-day       │
│ GoonFi V2    │     │ mints only   │     │ linear,      │
│              │     │ Size bounds  │     │ 7-day cliff  │
│ Best price,  │     │ Validated    │     │              │
│ agent never  │     │ BEFORE any   │     │ Manual in    │
│ touches it   │     │ proposal     │     │ V1 (open),   │
└──────────────┘     └──────────────┘     │ Streamflow   │
                                          │ in V2        │
                                          └──────────────┘

┌──────────────────────────────────────────────────┐
│           AGENT SELF-DIRECTION (05-allocate)       │
│                                                   │
│  Agent moves its OWN liquid USDC → SPCX:          │
│   1. $5 USDC: hot wallet → agent vault            │
│   2. Policy check (allowlist, size, balance)       │
│   3. Squads proposal: swap via Jupiter             │
│   4. Execute → SPCX lands in agent vault           │
│                                                   │
│  The agent invests within guardrails.              │
│  The policy is a constraint, not decoration.       │
└──────────────────────────────────────────────────┘

KEY ADDRESSES (mainnet):
• Treasury multisig: 4QBhBYPp8y6Mcw7UtycvG4ACuR6ThyMe97SEv87Wiy5m
• Treasury vault: Bjv8VJdAZqtYW3cz5nfNEnVZx2WwWMA1quqgPRGVQMTp
• Agent-1 multisig: HMnBxSuF5zVLaPUc7jNptbYSAYTfRw1jzBACRqNzkNde
• Agent-1 vault: HkSofdPwKHq6cp5Ej36KaLCMHU15U518HwyJY2fNd9Yi
• SPCX mint: SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb
• USDC mint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
