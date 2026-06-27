import { onValue, ref, type Database } from "firebase/database";
import type {
  FeedStatus,
  SourceAdapter,
  StatusListener,
  Tick,
  TickListener,
  Unsubscribe,
} from "@cancri/data-contracts";

/**
 * The live client adapter (ADR-0005/0006): subscribes to RTDB `/quotes/{isin}`
 * and `/feed/status` and emits normalised Ticks / FeedStatus. It implements the
 * exact same SourceAdapter interface as the Phase-1 simulator, so the app swaps
 * sim → live by changing the constructor, not the UI. The client only ever reads.
 */
export class RtdbSource implements SourceAdapter {
  readonly name = "rtdb";
  private readonly tickListeners = new Set<TickListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly quoteUnsubs = new Map<string, Unsubscribe>();
  private statusUnsub: Unsubscribe | null = null;

  constructor(private readonly db: Database) {}

  subscribe(instrumentIds: readonly string[]): void {
    for (const id of instrumentIds) {
      if (this.quoteUnsubs.has(id)) continue;
      const unsub = onValue(ref(this.db, `quotes/${id}`), (snap) => {
        const value = snap.val() as unknown;
        if (value !== null && typeof value === "object") {
          const tick = value as Tick;
          for (const l of this.tickListeners) l(tick);
        }
      });
      this.quoteUnsubs.set(id, unsub);
    }
  }

  unsubscribe(instrumentIds: readonly string[]): void {
    for (const id of instrumentIds) {
      this.quoteUnsubs.get(id)?.();
      this.quoteUnsubs.delete(id);
    }
  }

  onTick(listener: TickListener): Unsubscribe {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }
  onStatus(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  start(): void {
    this.statusUnsub = onValue(ref(this.db, "feed/status"), (snap) => {
      const value = snap.val() as unknown;
      if (value !== null && typeof value === "object") {
        const status = value as FeedStatus;
        for (const l of this.statusListeners) l(status);
      }
    });
  }

  stop(): void {
    for (const unsub of this.quoteUnsubs.values()) unsub();
    this.quoteUnsubs.clear();
    this.statusUnsub?.();
    this.statusUnsub = null;
  }
}
