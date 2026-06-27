import {
  makeTick,
  type FeedStatus,
  type SourceAdapter,
  type StatusListener,
  type TickListener,
  type Unsubscribe,
  type Freshness,
} from "@cancri/data-contracts";

/**
 * Dashboard scenarios the simulator can be driven through. `empty` is not here —
 * an empty dashboard is the inventory being empty, an app-level concern, not a
 * feed state (mirrors ConnectionState in data-contracts).
 */
export type SimScenario = "normal" | "reconnect" | "degraded" | "closed" | "error";

export interface SimSeed {
  readonly instrumentId: string;
  readonly previousClose: number;
  readonly source: string;
  readonly freshness: Freshness;
}

export interface SimSourceOptions {
  readonly intervalMs?: number;
  readonly rng?: () => number;
  readonly now?: () => number;
}

interface SimInstrument {
  price: number;
  readonly previousClose: number;
  readonly source: string;
  readonly baseFreshness: Freshness;
}

const RECONNECT_TO_DEGRADED_MS = 3200;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * In-browser SourceAdapter. Emits a normalised Tick stream and a FeedStatus stream
 * exactly like the real RTDB-backed adapter will (ADR-0005/0006), so the dashboard
 * is wired against the interface and nothing else. Extra `setScenario`/`scenario`
 * members exist only for the design-handoff review harness and are not part of
 * SourceAdapter.
 */
export class SimSource implements SourceAdapter {
  readonly name = "sim";

  private readonly instruments = new Map<string, SimInstrument>();
  private readonly subscribed = new Set<string>();
  private readonly tickListeners = new Set<TickListener>();
  private readonly statusListeners = new Set<StatusListener>();

  private readonly intervalMs: number;
  private readonly rng: () => number;
  private readonly now: () => number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  private _scenario: SimScenario = "normal";
  private tickCount = 0;
  private latencyMs = 38;
  private reconnectAttempt = 0;

  constructor(seeds: readonly SimSeed[], options: SimSourceOptions = {}) {
    this.intervalMs = options.intervalMs ?? 1000;
    this.rng = options.rng ?? Math.random;
    this.now = options.now ?? Date.now;
    for (const s of seeds) {
      this.instruments.set(s.instrumentId, {
        price: s.previousClose,
        previousClose: s.previousClose,
        source: s.source,
        baseFreshness: s.freshness,
      });
    }
  }

  get scenario(): SimScenario {
    return this._scenario;
  }

  // ---- SourceAdapter ----

  subscribe(instrumentIds: readonly string[]): void {
    for (const id of instrumentIds) {
      if (this.instruments.has(id)) this.subscribed.add(id);
    }
    if (this.running) for (const id of instrumentIds) this.emitOne(id);
  }

  unsubscribe(instrumentIds: readonly string[]): void {
    for (const id of instrumentIds) this.subscribed.delete(id);
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
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.step(), this.intervalMs);
    for (const id of this.subscribed) this.emitOne(id);
    this.publishStatus();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) clearInterval(this.timer);
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.timer = null;
    this.reconnectTimer = null;
  }

  // ---- review-harness only (not part of SourceAdapter) ----

  setScenario(scenario: SimScenario): void {
    this._scenario = scenario;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (scenario === "reconnect") {
      this.reconnectAttempt = 2;
      this.reconnectTimer = setTimeout(() => {
        if (this._scenario === "reconnect") this.setScenario("degraded");
      }, RECONNECT_TO_DEGRADED_MS);
    }
    this.publishStatus();
  }

  // ---- internals ----

  private flows(): boolean {
    return this._scenario === "normal" || this._scenario === "degraded";
  }

  private effectiveFreshness(base: Freshness): Freshness {
    return this._scenario === "degraded" ? "delayed" : base;
  }

  private step(): void {
    if (this.flows()) {
      const ids = [...this.subscribed];
      if (ids.length > 0) {
        const k = 3 + Math.floor(this.rng() * 3);
        for (let j = 0; j < k; j++) {
          const id = ids[Math.floor(this.rng() * ids.length)];
          if (id !== undefined) this.driftAndEmit(id);
        }
        this.tickCount++;
      }
      this.latencyMs =
        this._scenario === "degraded"
          ? 180 + Math.floor(this.rng() * 120)
          : 28 + Math.floor(this.rng() * 26);
    }
    this.publishStatus();
  }

  private driftAndEmit(id: string): void {
    const inst = this.instruments.get(id);
    if (inst === undefined) return;
    const drift = (this.rng() - 0.5) * 0.012;
    inst.price = Math.max(0.01, +(inst.price * (1 + drift)).toFixed(2));
    this.emitOne(id);
  }

  private emitOne(id: string): void {
    const inst = this.instruments.get(id);
    if (inst === undefined) return;
    const tick = makeTick({
      instrumentId: id,
      lastPrice: inst.price,
      previousClose: inst.previousClose,
      timestamp: this.now(),
      source: inst.source,
      freshness: this.effectiveFreshness(inst.baseFreshness),
    });
    for (const l of this.tickListeners) l(tick);
  }

  private publishStatus(): void {
    const s = this._scenario;
    const feedNote =
      s === "degraded"
        ? "fallback: cboe delayed"
        : s === "closed"
          ? "session: closed"
          : "primary: ws · realtime";
    const status: FeedStatus = {
      connection: s === "normal" ? "live" : s,
      marketState: s === "closed" ? "closed" : "open",
      latencyMs: this.latencyMs,
      ticks: this.tickCount,
      feedNote,
      updatedAt: this.now(),
      ...(s === "reconnect"
        ? { reconnectAttempt: this.reconnectAttempt, maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS }
        : {}),
    };
    for (const l of this.statusListeners) l(status);
  }
}
