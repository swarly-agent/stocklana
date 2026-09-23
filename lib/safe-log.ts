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

const B58_SIG = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;

/**
 * Print a transaction signature. A signature is public by construction — it
 * only exists after the transaction is sent — so the CALLER declares the
 * value is a signature, which is what distinguishes it from a same-shaped
 * (64-byte base58) secret key. Rejects anything not signature-shaped.
 * Use this for every signature; never pass one to pub().
 */
export function sig(label: string, value: string): void {
  if (!B58_SIG.test(value)) {
    throw new Error(`refusing to print non-signature-shaped value for "${label}"`);
  }
  console.log(`${label}: ${value}`);
}
