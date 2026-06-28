/**
 * Display currency for the dashboard. Prices flow through the (simulated) feed in
 * USD; the user can re-express the whole book in another currency. Rates are a
 * small, static, INDICATIVE table — there is no live FX source yet, and the
 * terminal stays honest about that (the selector is labelled "indicative"). Wiring
 * a real server-side FX feed would be its own ADR.
 */

export interface Currency {
  readonly code: string;
  readonly symbol: string;
  /** Units of this currency per 1 USD. */
  readonly perUsd: number;
  /** Fraction digits for amounts in this currency (JPY has none). */
  readonly frac: number;
}

export const CURRENCIES: readonly Currency[] = [
  { code: "USD", symbol: "$", perUsd: 1, frac: 2 },
  { code: "EUR", symbol: "€", perUsd: 0.92, frac: 2 },
  { code: "GBP", symbol: "£", perUsd: 0.79, frac: 2 },
  { code: "CHF", symbol: "Fr", perUsd: 0.89, frac: 2 },
  { code: "JPY", symbol: "¥", perUsd: 157, frac: 0 },
  { code: "CAD", symbol: "C$", perUsd: 1.37, frac: 2 },
  { code: "AUD", symbol: "A$", perUsd: 1.51, frac: 2 },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c] as const));

export function currencyOf(code: string): Currency {
  return BY_CODE.get(code) ?? CURRENCIES[0]!;
}

/** Convert a USD amount into the target currency. */
export function convert(usd: number, code: string): number {
  return usd * currencyOf(code).perUsd;
}

/** A USD amount as a currency-prefixed, whole-number string (header/position cells). */
export function fmtMoney0(usd: number, code: string): string {
  const c = currencyOf(code);
  return `${c.symbol} ${Math.round(usd * c.perUsd).toLocaleString("en-US")}`;
}

/** A converted price with the currency's fraction digits — no symbol (tight cells). */
export function fmtPrice(usd: number, code: string): string {
  const c = currencyOf(code);
  return (usd * c.perUsd).toLocaleString("en-US", {
    minimumFractionDigits: c.frac,
    maximumFractionDigits: c.frac,
  });
}
