import type { Tick } from "./tick.js";
import type { FeedStatus } from "./feed.js";

/**
 * The source-agnostic interface the app subscribes against (ADR-0006). The brief's
 * central promise — "the app subscribes only against this interface and never knows
 * the concrete source" — is enforced here: callers see Ticks and FeedStatus, never
 * Lightstreamer frames, protobuf, or internal ids.
 *
 * In production the client's adapter is backed by an RTDB subscription (ADR-0005)
 * and the L&S/Yahoo adapters live server-side in the feed-engine (ADR-0002/0003).
 * In Phase 1 the in-browser simulator implements this same interface, so swapping
 * the real source in later is a constructor change, not a UI change.
 */
export type Unsubscribe = () => void;
export type TickListener = (tick: Tick) => void;
export type StatusListener = (status: FeedStatus) => void;

export interface SourceAdapter {
  /** Stable identifier for diagnostics, e.g. "sim", "rtdb", "ls". */
  readonly name: string;

  /** Begin maintaining quotes for these instrument ids (union, idempotent). */
  subscribe(instrumentIds: readonly string[]): void;
  /** Stop maintaining quotes for these instrument ids. */
  unsubscribe(instrumentIds: readonly string[]): void;

  /** Register a tick listener; returns an unsubscribe handle. */
  onTick(listener: TickListener): Unsubscribe;
  /** Register a feed-status listener; returns an unsubscribe handle. */
  onStatus(listener: StatusListener): Unsubscribe;

  /** Open the connection / begin emitting. */
  start(): void;
  /** Tear down the connection / stop emitting. */
  stop(): void;
}
