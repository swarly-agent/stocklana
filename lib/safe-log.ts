// lib/safe-log.ts — printing discipline for scripts.
//
// Scripts may print PUBLIC values only: pubkeys, signatures, amounts,
// quote numbers. This module refuses to print anything shaped like a
// secret (base58 64-byte key, JSON byte-array key export).

const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

function looksLikeSecret(value: string): boolean {
  // base58-encoded 64-byte secret key (typically 87-88 chars)
  if (B58.test(value) && value.length >= 86 && value.length <= 90) return true;
  // Solana secret-key JSON export: array of 64 numbers
  if (/^\[\s*\d+(\s*,\s*\d+){63}\s*\]$/.test(value)) return true;
  return false;
}

/** Print a public value. Throws if it looks like a secret. */
export function pub(label: string, value: string): void {
  if (looksLikeSecret(value)) {
    throw new Error(`refusing to print secret-shaped value for "${label}"`);
  }
  console.log(`${label}: ${value}`);
}

/** True if the value is safe to embed in a report. */
export function isSafeToPrint(value: string): boolean {
  return !looksLikeSecret(value);
}
