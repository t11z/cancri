/**
 * The normalised tick — the only price shape that ever crosses the client/server
 * seam (ADR-0006). Adapters map their native payloads to this internally; nothing
 * source-specific (Lightstreamer frames, protobuf, internal ids, venue codes used
 * for identity) is allowed to leak past it.
 *
 * `instrumentId` is the canonical ISIN end to end (ADR-0007). For the Phase-1
 * simulator the id is a synthetic stand-in, but the shape is identical.
 *
 * Day-change is ALWAYS hub-computed from `lastPrice` and `previousClose` and never
 * trusted from a source: L&S sends only the latest tick with no close, so the
 * baseline is a separate daily read (Yahoo in production; the sim provides it).
 */
export type Freshness = "live" | "delayed";

export interface Tick {
  /** Canonical instrument id (ISIN in production; synthetic in the simulator). */
  readonly instrumentId: string;
  /** Latest traded price. */
  readonly lastPrice: number;
  /** Previous-session close — the day-change baseline (a daily read, not a tick). */
  readonly previousClose: number;
  /** Hub-computed: lastPrice - previousClose. */
  readonly dayChangeAbs: number;
  /** Hub-computed: (lastPrice - previousClose) / previousClose * 100. */
  readonly dayChangePct: number;
  /** Epoch milliseconds at which the source emitted this tick. */
  readonly timestamp: number;
  /** Display venue/source, e.g. "NASDAQ", "COINBASE", "L&S", "YAHOO", "SIM". */
  readonly source: string;
  /** Per-tick data quality: a live source's quote vs a knowingly delayed one. */
  readonly freshness: Freshness;
}

/** Build a Tick with the derived day-change fields computed once, at the hub. */
export function makeTick(input: {
  instrumentId: string;
  lastPrice: number;
  previousClose: number;
  timestamp: number;
  source: string;
  freshness: Freshness;
}): Tick {
  const dayChangeAbs = input.lastPrice - input.previousClose;
  const dayChangePct =
    input.previousClose !== 0 ? (dayChangeAbs / input.previousClose) * 100 : 0;
  return {
    instrumentId: input.instrumentId,
    lastPrice: input.lastPrice,
    previousClose: input.previousClose,
    dayChangeAbs,
    dayChangePct,
    timestamp: input.timestamp,
    source: input.source,
    freshness: input.freshness,
  };
}
