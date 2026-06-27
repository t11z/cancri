import type { SourceAdapter } from "@cancri/data-contracts";
import type { TickSink } from "./rtdb-writer.js";

/**
 * Orchestrates one source adapter into the RTDB sink (ADR-0003/0005). Maintains
 * the subscription union from the set of held ISINs across all users, so each
 * upstream instrument is tapped exactly once, not per user. The full degradation
 * FSM and the Yahoo sanity oracle layer on here in Phase 5.
 */
export class FeedManager {
  private readonly subscribed = new Set<string>();
  private offTick: (() => void) | null = null;
  private offStatus: (() => void) | null = null;

  constructor(
    private readonly source: SourceAdapter,
    private readonly sink: TickSink,
  ) {}

  start(): void {
    this.offTick = this.source.onTick((t) => void this.sink.writeTick(t));
    this.offStatus = this.source.onStatus((s) => void this.sink.writeStatus(s));
    this.source.start();
  }

  /** Reconcile the live subscription set with the held-ISIN universe (diff only). */
  setUniverse(isins: readonly string[]): void {
    const next = new Set(isins);
    const toAdd = [...next].filter((id) => !this.subscribed.has(id));
    const toRemove = [...this.subscribed].filter((id) => !next.has(id));
    if (toAdd.length > 0) this.source.subscribe(toAdd);
    if (toRemove.length > 0) this.source.unsubscribe(toRemove);
    for (const id of toAdd) this.subscribed.add(id);
    for (const id of toRemove) this.subscribed.delete(id);
  }

  get universe(): string[] {
    return [...this.subscribed];
  }

  stop(): void {
    this.offTick?.();
    this.offStatus?.();
    this.source.stop();
  }
}
