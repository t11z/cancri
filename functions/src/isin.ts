/**
 * ISIN validation — the deterministic gate that disposes of the LLM's proposed
 * identity (ADR-0007). ISIN is the canonical key; an unverified one must never
 * reach the live layer. This is the Luhn (mod-10) check-digit test over the
 * letter-expanded ISIN. Cross-resolution against the L&S instrument-search
 * endpoint is layered on in Phase 4; here we reject fabricated/mistyped ISINs.
 */
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

function charValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 48; // '0'-'9' -> 0..9
  if (code >= 65 && code <= 90) return code - 55; // 'A'-'Z' -> 10..35
  return -1;
}

export function isValidIsin(isin: string): boolean {
  if (!ISIN_RE.test(isin)) return false;

  // Expand letters to digits, then concatenate into one numeric string.
  let digits = "";
  for (let i = 0; i < isin.length; i++) {
    const v = charValue(isin.charCodeAt(i));
    if (v < 0) return false;
    digits += String(v);
  }

  // Luhn mod-10 over the expanded string (rightmost digit is the check digit).
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}
