/**
 * Runtime sanity oracle (brief §D). Compares the primary (L&S) price against the
 * independent Yahoo reference. Only SUSTAINED divergence over a window trips it —
 * Yahoo's ~15-min delay produces false one-off divergences on fast moves, so a
 * single outlier must not degrade the feed. The oracle is a DEGRADE TRIGGER only;
 * it never verifies a self-heal fix (that is the deterministic replay).
 */
export interface OracleOptions {
  /** Percent divergence above which a single comparison counts as diverged. */
  readonly thresholdPct?: number;
  /** Number of consecutive diverged comparisons required to trip. */
  readonly window?: number;
}

export class SanityOracle {
  private readonly thresholdPct: number;
  private readonly window: number;
  private readonly recent = new Map<string, boolean[]>();

  constructor(options: OracleOptions = {}) {
    this.thresholdPct = options.thresholdPct ?? 2;
    this.window = options.window ?? 3;
  }

  /** Record a comparison; returns true once divergence is sustained over the window. */
  observe(isin: string, primaryPrice: number, referencePrice: number): boolean {
    const divergencePct =
      referencePrice !== 0 ? (Math.abs(primaryPrice - referencePrice) / referencePrice) * 100 : 0;
    const diverged = divergencePct > this.thresholdPct;

    const flags = this.recent.get(isin) ?? [];
    flags.push(diverged);
    while (flags.length > this.window) flags.shift();
    this.recent.set(isin, flags);

    return flags.length >= this.window && flags.every((f) => f);
  }

  reset(isin: string): void {
    this.recent.delete(isin);
  }
}
