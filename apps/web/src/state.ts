import type { Freshness, Position, FeedStatus, LogoState } from "@cancri/data-contracts";

export type Screen = "boot" | "auth" | "denied" | "onboard" | "confirm" | "dash";

/**
 * Dashboard secondary states. Five map to feed/connection states the SourceAdapter
 * publishes; `empty` is purely app-level (no instruments loaded).
 */
export type DashState = "normal" | "degraded" | "reconnect" | "closed" | "empty" | "error";

/** A confirmed holding plus its logo lifecycle state (Phase-1 demo enrichment). */
export interface DemoPosition extends Position {
  readonly logoState: LogoState;
}

export interface FlashMark {
  dir: "up" | "down";
  t: number;
}

/**
 * Hot, per-instrument state mutated on the tick hot-path and read each rAF frame.
 * Kept off any reactive store (ADR-0011): plain Maps, mutated in place.
 */
export interface HotState {
  /** Latest target price from ticks. */
  readonly price: Map<string, number>;
  /** Day-change baseline from ticks. */
  readonly prev: Map<string, number>;
  /** Lerped display price (number-roll). */
  readonly disp: Map<string, number>;
  /** Rolling sparkline series (~48 pts). */
  readonly series: Map<string, number[]>;
  /** Directional flash marker, decays over flashMs. */
  readonly flash: Map<string, FlashMark>;
  /** Per-instrument freshness from the latest tick. */
  readonly fresh: Map<string, Freshness>;
}

export function emptyHot(): HotState {
  return {
    price: new Map(),
    prev: new Map(),
    disp: new Map(),
    series: new Map(),
    flash: new Map(),
    fresh: new Map(),
  };
}

export const SPARK_LEN = 48;

export interface AppView {
  screen: Screen;
  dashState: DashState;
  reduce: boolean;
  bootStep: number;
  inventory: readonly DemoPosition[];
  hot: HotState;
  feed: FeedStatus;
}
