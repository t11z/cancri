/**
 * Global feed status — the second thing the feed-engine publishes (RTDB
 * `/feed/status` in production, ADR-0005). It is a single global object, distinct
 * from per-tick `freshness`: a source can be `live` yet a specific instrument
 * stale, and the whole feed can be `degraded` while ticks still flow from the
 * fallback.
 *
 * `connection` maps to the dashboard's secondary states. Note that `empty`
 * (no instruments loaded) is NOT a connection state — it is derived from the
 * inventory being empty — so it is intentionally absent here.
 */
export type ConnectionState =
  | "live" // primary source healthy, realtime
  | "reconnect" // primary lost, attempting to recover (dashboard stays warm)
  | "degraded" // gave up on primary, serving delayed fallback
  | "closed" // market closed, last close shown
  | "error"; // could not reach any source

export type MarketState = "open" | "closed";

export interface FeedStatus {
  readonly connection: ConnectionState;
  readonly marketState: MarketState;
  /** Round-trip-ish latency estimate in ms (climbs while degraded). */
  readonly latencyMs: number;
  /** Cumulative ticks observed since the feed started. */
  readonly ticks: number;
  /** Present only while connection === "reconnect". */
  readonly reconnectAttempt?: number;
  readonly maxReconnectAttempts?: number;
  /** Short human note for the footer, e.g. "primary: ws · realtime". */
  readonly feedNote: string;
  /** Epoch ms of last status change. */
  readonly updatedAt: number;
}
