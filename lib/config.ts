// lib/config.ts — ALL locked project constants.
// Public values ONLY: program IDs, mints, addresses, economics.
// NEVER secrets. Secrets live outside the git tree (see KEYS_DIR below).

import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------- programs
export const SQUADS_V4_PROGRAM_ID =
  "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
export const TOKEN_2022_PROGRAM_ID =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"; // [fixed 2026-09-22 — scaffold had a typo; verified against @solana/spl-token export AND the SPCX mint's onchain owner]
export const TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// -------------------------------------------------------------------- mints
export const MINTS = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  DKNG: "DKNGQFNGQmoBdXSRGKJ8tTu7uPDasw5JDcfMmWniNfow",
  ALLINU: "4MMQY9bwkxxTtsK3W227Q5ABT6yFY8Pmn9Ze7wmAXKY8",
  // [checked 2026-09-22 — verified via Jupiter lite-api search, Token-2022,
  // 6 decimals; see research/backpack-securities-mechanics-2026-09-22.md]
  SPCX: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb",
} as const;

export const MINT_DECIMALS = { USDC: 6, DKNG: 6, SPCX: 6, ALLINU: 6 } as const;

// ------------------------------------------------------------------ wallets
/** Funded project wallet (public address — safe in repo). */
export const TREASURY_WALLET = "3qmtjz6UuNWdXfxPu9mmZzn6kjourdVjEVRh8Wyq5Rto";

// ---------------------------------------------------------------- economics
// LOCKED 2026-09-22. Protocol fee is taken at bounty payout, never at swap.
export const PROTOCOL_FEE_BPS = 200; // 2%
export const WORKER_USDC_BPS = 7000; // 70% liquid USDC
export const WORKER_VESTED_BPS = 3000; // 30% vested SPCX (protocol auto-swaps; the worker never touches the swap)
export const EMPLOYER_MATCH_BPS = 1000; // 10% of the vested portion
export const VESTING_DURATION_DAYS = 90; // linear
export const VESTING_CLIFF_DAYS = 7;

export const BOUNTY_USD = { ONE: 20, TWO: 10, MICRO_MIN: 3, MICRO_MAX: 5 } as const;

/** Treasury's USDC→SPCX acquisition (02b) — covers vested slices + matches + buffer. */
export const TREASURY_SPCX_ACQUIRE_USD = 12;

/**
 * Reference payouts (USD-denominated; the vested slice is SPCX).
 * 04-payout converts the USD-denominated vested slice at the LIVE Jupiter
 * quote — these are sanity anchors for review, NOT script inputs.
 */
export const REFERENCE_PAYOUTS = {
  bounty001: { feeUsd: 0.4, usdc: 13.72, spcxVested: 5.88, spcxMatch: 0.588 },
  bounty002: { feeUsd: 0.2, usdc: 6.86, spcxVested: 2.94, spcxMatch: 0.294 },
} as const;

// ------------------------------------------------------------------- squads
/** Treasury: 2 members (script key + Sting's pubkey), threshold 1. */
export const TREASURY_THRESHOLD = 1;
/** Agent vaults: 1 member (script-held agent key), threshold 1. */
export const AGENT_VAULT_THRESHOLD = 1;
/**
 * Sting's fresh treasury-member public key. He keeps the private key; only
 * the pubkey ever touches the repo or scripts. Set via STING_MEMBER_PUBKEY
 * env var. 01-create-vaults refuses the real run while this is empty.
 */
export const STING_MEMBER_PUBKEY: string = process.env.STING_MEMBER_PUBKEY ?? "";

// ------------------------------------------------------------------ jupiter
export const JUPITER_SWAP_BUILD_URL = "https://api.jup.ag/swap/v2/build";
/** Set explicitly on every request — never rely on the documented default. */
export const JUPITER_SLIPPAGE_BPS = 50;

// ---------------------------------------------------------------------- rpc
/** Scripts use Helius (key outside the repo). Dashboard live tier below. */
export const PUBLIC_RPC_ENDPOINTS = [
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
] as const;

// ------------------------------------------------------------------ secrets
/**
 * Secrets are NEVER in this file and NEVER in this repo. Scripts resolve the
 * out-of-tree keys directory via STOCKLANA_KEYS_DIR
 * (default: ~/workspace/stocklana/hidden_files). Key files are read at
 * runtime by lib/solana.ts (Wednesday) — never logged, never committed.
 */
export const KEYS_DIR: string =
  process.env.STOCKLANA_KEYS_DIR ??
  path.join(os.homedir(), "workspace", "stocklana", "hidden_files");
