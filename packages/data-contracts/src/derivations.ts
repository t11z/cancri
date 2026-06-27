import type { Freshness } from "./tick.js";

/**
 * View model + pure derivations shared by any renderer (handover `derivations`).
 * Kept here so the client and any server-side aggregation compute identical numbers.
 */

export type LogoState = "loading" | "resolved" | "monogram";

/** Everything one dashboard row needs, after joining a Position with its latest Tick. */
export interface AssetRowData {
  readonly identity: string;
  readonly displayName: string;
  readonly symbol: string;
  readonly quantity: number;
  readonly lastPrice: number;
  readonly previousClose: number;
  readonly dayChangeAbs: number;
  readonly dayChangePct: number;
  readonly positionValue: number;
  readonly freshness: Freshness;
  readonly source: string;
  /** Decorative identity colour (accent_palette), never up/down/warn. */
  readonly accent: string;
  readonly logoState: LogoState;
  readonly logoUrl?: string;
}

export interface Aggregate {
  readonly totalValue: number;
  readonly dayChangeAbs: number;
  readonly dayChangePct: number;
}

export function positionValue(quantity: number, lastPrice: number): number {
  return quantity * lastPrice;
}

export function dayChangeAbs(lastPrice: number, previousClose: number): number {
  return lastPrice - previousClose;
}

export function dayChangePct(lastPrice: number, previousClose: number): number {
  return previousClose !== 0 ? ((lastPrice - previousClose) / previousClose) * 100 : 0;
}

/** Σ over rows, exactly as the handover specifies the header aggregate. */
export function aggregate(
  rows: readonly Pick<AssetRowData, "quantity" | "lastPrice" | "previousClose">[],
): Aggregate {
  let totalValue = 0;
  let prevValue = 0;
  for (const r of rows) {
    totalValue += r.quantity * r.lastPrice;
    prevValue += r.quantity * r.previousClose;
  }
  const abs = totalValue - prevValue;
  const pct = prevValue !== 0 ? (abs / prevValue) * 100 : 0;
  return { totalValue, dayChangeAbs: abs, dayChangePct: pct };
}

/** Stable accent pick: hash an identity into the handover accent_palette. */
export function accentForIdentity(identity: string, palette: readonly string[]): string {
  let h = 0;
  for (let i = 0; i < identity.length; i++) {
    h = (h * 31 + identity.charCodeAt(i)) >>> 0;
  }
  // palette is never empty in practice; fall back to the first entry defensively.
  return palette[h % palette.length] ?? palette[0] ?? "#7b5cff";
}

/** Monogram initials per the handover: ticker.slice(0, len > 3 ? 3 : len), upper. */
export function monogramInitials(ticker: string): string {
  return ticker.slice(0, ticker.length > 3 ? 3 : ticker.length).toUpperCase();
}
