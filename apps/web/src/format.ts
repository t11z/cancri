// Number formatting — tabular-friendly, matches the handover reference exactly.

export const m2 = (n: number): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const m0 = (n: number): string => Math.round(n).toLocaleString("en-US");

export const pct = (n: number): string => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";

/** Wall clock in ET-style HH:MM:SS (handover uses en-GB 24h formatting). */
export const clockString = (d: Date): string => d.toLocaleTimeString("en-GB");
