import type WebSocket from "ws";
import {
  makeTick,
  type SourceAdapter,
  type StatusListener,
  type TickListener,
  type Unsubscribe,
} from "@cancri/data-contracts";
import { getActiveProtocol, type ProtocolModule } from "./ls-protocol/index.js";

export interface LsAdapterDeps {
  /** ISIN for a source-internal instrument id (L&S instrument-search resolves this). */
  isinForId(id: string): string | undefined;
  /** Previous-session close for an ISIN (a daily Yahoo read; Phase 5). */
  previousClose(isin: string): number;
  now?: () => number;
}

/**
 * The L&S primary tap (ADR-0009). The frame→Tick path is pure and tested; the live
 * socket lifecycle (subprotocol/origin handshake, create_session, subscription
 * frames) is structured but inert here — it is unverifiable without the live
 * source and is filled from the first capture (Phase 6). Nothing source-specific
 * leaves this class: callers see only normalised Ticks.
 */
export class LsSourceAdapter implements SourceAdapter {
  readonly name = "ls";
  private readonly tickListeners = new Set<TickListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly now: () => number;
  private ws: WebSocket | null = null;

  constructor(
    private readonly deps: LsAdapterDeps,
    private readonly module: ProtocolModule = getActiveProtocol(),
  ) {
    this.now = deps.now ?? Date.now;
  }

  /** Decode one raw frame and emit a normalised Tick. The live socket's message
   *  handler calls this; exposed so the decode path is testable offline. */
  handleFrame(raw: string): void {
    const update = this.module.decodeFrame(raw);
    if (update === null) return;
    const isin = this.deps.isinForId(update.id);
    if (isin === undefined) return;
    const tick = makeTick({
      instrumentId: isin,
      lastPrice: update.price,
      previousClose: this.deps.previousClose(isin),
      timestamp: this.now(),
      source: "L&S",
      freshness: "live",
    });
    for (const l of this.tickListeners) l(tick);
  }

  subscribe(_ids: readonly string[]): void {
    // LIVE: send L&S subscription frames over the socket for these instruments.
  }
  unsubscribe(_ids: readonly string[]): void {
    // LIVE: send L&S unsubscribe frames.
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
    // LIVE: open the ls-tc.de socket with the protocol's required subprotocol +
    // Origin, POST buildCreateSession(), and route frames to handleFrame().
    // Inert until wired with real handshake bytes + credentials (Phase 6 capture).
  }
  stop(): void {
    this.ws?.close();
    this.ws = null;
  }
}
