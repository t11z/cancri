import type { SourceAdapter, Tick, Unsubscribe } from "@cancri/data-contracts";
import type { TickSink } from "./rtdb-writer.js";
import { FeedStateMachine, deriveStatus } from "./feed-state.js";
import type { SanityOracle } from "./sanity-oracle.js";

export interface OrchestratorOptions {
  now?: () => number;
}

/**
 * Ties the primary (L&S) + fallback (Yahoo) adapters, the sanity oracle and the
 * degradation FSM into the sole RTDB writer (ADR-0003/0005). Honesty over
 * blackout: while LIVE it writes primary ticks; on degrade it serves the delayed
 * fallback and never blanks. Event-driven — the live silence watchdog calls
 * notifyPrimaryLost / notifyReconnectExhausted; the oracle degrades on sustained
 * divergence. Supersedes the Phase-4 FeedManager for the live, dual-source path.
 */
export class FeedOrchestrator {
  private ticks = 0;
  private readonly latestFallback = new Map<string, number>();
  private offPrimary: Unsubscribe | null = null;
  private offFallback: Unsubscribe | null = null;
  private readonly now: () => number;

  constructor(
    private readonly primary: SourceAdapter,
    private readonly fallback: SourceAdapter,
    private readonly oracle: SanityOracle,
    private readonly sink: TickSink,
    private readonly fsm: FeedStateMachine,
    options: OrchestratorOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  start(): void {
    this.offPrimary = this.primary.onTick((t) => this.onPrimary(t));
    this.offFallback = this.fallback.onTick((t) => this.onFallback(t));
    this.primary.start();
    this.fallback.start();
    this.publish();
  }

  setUniverse(isins: readonly string[]): void {
    this.primary.subscribe(isins);
    this.fallback.subscribe(isins);
  }

  notifyPrimaryLost(): void {
    this.fsm.dispatch({ type: "primary_lost" });
    this.publish();
  }
  notifyReconnectExhausted(): void {
    this.fsm.dispatch({ type: "reconnect_exhausted" });
    this.publish();
  }
  notifyMarket(open: boolean): void {
    this.fsm.dispatch({ type: open ? "market_open" : "market_closed" });
    this.publish();
  }

  private degraded(): boolean {
    return this.fsm.state === "degraded";
  }

  private onFallback(t: Tick): void {
    this.latestFallback.set(t.instrumentId, t.lastPrice);
    if (this.degraded()) {
      void this.sink.writeTick(t); // already freshness:"delayed"
      this.ticks++;
      this.publish();
    }
  }

  private onPrimary(t: Tick): void {
    const reference = this.latestFallback.get(t.instrumentId);
    if (reference !== undefined) {
      if (this.oracle.observe(t.instrumentId, t.lastPrice, reference)) {
        // sustained divergence → degrade to the fallback
        this.fsm.dispatch({ type: "primary_lost" });
        this.fsm.dispatch({ type: "reconnect_exhausted" });
        this.publish();
        return;
      }
      this.fsm.dispatch({ type: "sane_tick" });
    }
    if (this.fsm.state === "live") {
      void this.sink.writeTick(t);
      this.ticks++;
      this.publish();
    }
  }

  private publish(): void {
    void this.sink.writeStatus(
      deriveStatus(this.fsm, { ticks: this.ticks, latencyMs: this.degraded() ? 200 : 35 }, this.now()),
    );
  }

  stop(): void {
    this.offPrimary?.();
    this.offFallback?.();
    this.primary.stop();
    this.fallback.stop();
  }
}
