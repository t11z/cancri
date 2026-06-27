import {
  makeTick,
  type SourceAdapter,
  type StatusListener,
  type TickListener,
  type Unsubscribe,
} from "@cancri/data-contracts";
import { decodeYahooFrame } from "./proto.js";

export interface YahooAdapterDeps {
  /** ISIN for a Yahoo id (e.g. "BAY.DE"); the inverse of the venue-suffix mapping. */
  isinForYahooId(yahooId: string): string | undefined;
  previousClose(isin: string): number;
  now?: () => number;
}

/**
 * Yahoo fallback + sanity-oracle source (brief Appendix B). Always emits
 * `freshness: "delayed"` regardless of socket liveness — German venues are ~15 min
 * delayed, so this is never the primary display, only the fallback and the
 * independent reference. The live WSS connection is a flagged scaffold.
 */
export class YahooSourceAdapter implements SourceAdapter {
  readonly name = "yahoo";
  private readonly tickListeners = new Set<TickListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly now: () => number;

  constructor(private readonly deps: YahooAdapterDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Decode one protobuf frame and emit a delayed Tick. The live socket calls this. */
  handleFrame(base64: string): void {
    const quote = decodeYahooFrame(base64);
    const isin = this.deps.isinForYahooId(quote.id);
    if (isin === undefined) return;
    const tick = makeTick({
      instrumentId: isin,
      lastPrice: quote.price,
      previousClose: this.deps.previousClose(isin),
      timestamp: this.now(),
      source: "YAHOO",
      freshness: "delayed",
    });
    for (const l of this.tickListeners) l(tick);
  }

  subscribe(_ids: readonly string[]): void {
    // LIVE: subscribe symbols on wss://streamer.finance.yahoo.com/.
  }
  unsubscribe(_ids: readonly string[]): void {}

  onTick(listener: TickListener): Unsubscribe {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }
  onStatus(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  start(): void {
    // LIVE: open Yahoo WSS, decode protobuf frames into handleFrame(). Inert here.
  }
  stop(): void {}
}
