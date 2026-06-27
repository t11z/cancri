import type { ConnectionState, FeedStatus } from "@cancri/data-contracts";

/**
 * The degradation FSM (brief §C/§F, motion_spec connection_transition). Honesty
 * over blackout: the dashboard never blanks, it flips LIVE→DELAYED. Recovery is
 * hysteretic — it takes several consecutive sane primary signals to return to
 * LIVE — to avoid flapping. Outside trading hours the state is CLOSED, not error.
 */
export type FeedEvent =
  | { type: "primary_lost" }
  | { type: "reconnect_attempt" }
  | { type: "reconnect_exhausted" }
  | { type: "sane_tick" } // a primary tick that passed the oracle
  | { type: "market_closed" }
  | { type: "market_open" }
  | { type: "error" }
  | { type: "retry" };

export interface FeedStateOptions {
  readonly maxReconnectAttempts?: number;
  /** Consecutive sane ticks required to recover (hysteresis). */
  readonly recoverAfter?: number;
}

export class FeedStateMachine {
  private _state: ConnectionState = "live";
  private _attempt = 0;
  private saneStreak = 0;
  private readonly max: number;
  private readonly recoverAfter: number;

  constructor(options: FeedStateOptions = {}) {
    this.max = options.maxReconnectAttempts ?? 5;
    this.recoverAfter = options.recoverAfter ?? 3;
  }

  get state(): ConnectionState {
    return this._state;
  }
  get attempt(): number {
    return this._attempt;
  }
  get maxAttempts(): number {
    return this.max;
  }

  dispatch(event: FeedEvent): ConnectionState {
    switch (event.type) {
      case "error":
        this._state = "error";
        break;
      case "retry":
        if (this._state === "error") this.toLive();
        break;
      case "market_closed":
        this._state = "closed";
        break;
      case "market_open":
        if (this._state === "closed") this.toLive();
        break;
      case "primary_lost":
        if (this._state === "live") {
          this._state = "reconnect";
          this._attempt = 1;
          this.saneStreak = 0;
        }
        break;
      case "reconnect_attempt":
        if (this._state === "reconnect") {
          this._attempt += 1;
          if (this._attempt > this.max) this._state = "degraded";
        }
        break;
      case "reconnect_exhausted":
        if (this._state === "reconnect") this._state = "degraded";
        break;
      case "sane_tick":
        if (this._state === "reconnect" || this._state === "degraded") {
          this.saneStreak += 1;
          if (this.saneStreak >= this.recoverAfter) this.toLive();
        }
        break;
    }
    return this._state;
  }

  private toLive(): void {
    this._state = "live";
    this._attempt = 0;
    this.saneStreak = 0;
  }
}

export function deriveStatus(
  fsm: FeedStateMachine,
  counters: { ticks: number; latencyMs: number },
  now: number,
): FeedStatus {
  const connection = fsm.state;
  const feedNote =
    connection === "degraded"
      ? "fallback: yahoo · ~15m lag"
      : connection === "closed"
        ? "session: closed"
        : connection === "error"
          ? "no source"
          : "primary: ls · realtime";
  return {
    connection,
    marketState: connection === "closed" ? "closed" : "open",
    latencyMs: counters.latencyMs,
    ticks: counters.ticks,
    feedNote,
    updatedAt: now,
    ...(connection === "reconnect"
      ? { reconnectAttempt: fsm.attempt, maxReconnectAttempts: fsm.maxAttempts }
      : {}),
  };
}
