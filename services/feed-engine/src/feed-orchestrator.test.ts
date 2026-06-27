import { describe, expect, test } from "vitest";
import {
  makeTick,
  type FeedStatus,
  type SourceAdapter,
  type StatusListener,
  type Tick,
  type TickListener,
  type Unsubscribe,
} from "@cancri/data-contracts";
import { FeedOrchestrator } from "./feed-orchestrator.js";
import { FeedStateMachine } from "./feed-state.js";
import { SanityOracle } from "./sanity-oracle.js";
import type { TickSink } from "./rtdb-writer.js";

class FakeAdapter implements SourceAdapter {
  constructor(readonly name: string) {}
  private tick: TickListener | null = null;
  subscribe(): void {}
  unsubscribe(): void {}
  onTick(l: TickListener): Unsubscribe {
    this.tick = l;
    return () => {
      this.tick = null;
    };
  }
  onStatus(_l: StatusListener): Unsubscribe {
    return () => {};
  }
  start(): void {}
  stop(): void {}
  emit(t: Tick): void {
    this.tick?.(t);
  }
}

class FakeSink implements TickSink {
  ticks: Tick[] = [];
  statuses: FeedStatus[] = [];
  writeTick(t: Tick): void {
    this.ticks.push(t);
  }
  writeStatus(s: FeedStatus): void {
    this.statuses.push(s);
  }
}

const tick = (source: string, freshness: "live" | "delayed", price: number): Tick =>
  makeTick({ instrumentId: "X", lastPrice: price, previousClose: 100, timestamp: 1, source, freshness });

describe("FeedOrchestrator", () => {
  test("writes primary ticks while LIVE", () => {
    const sink = new FakeSink();
    const orch = new FeedOrchestrator(
      new FakeAdapter("ls"),
      new FakeAdapter("yahoo"),
      new SanityOracle(),
      sink,
      new FeedStateMachine(),
      { now: () => 1 },
    );
    const primary = (orch as unknown as { primary: FakeAdapter }).primary;
    orch.start();
    primary.emit(tick("L&S", "live", 101));
    expect(sink.ticks).toHaveLength(1);
    expect(sink.statuses.at(-1)?.connection).toBe("live");
  });

  test("on degrade it serves the delayed fallback, never blanks", () => {
    const sink = new FakeSink();
    const primary = new FakeAdapter("ls");
    const fallback = new FakeAdapter("yahoo");
    const orch = new FeedOrchestrator(primary, fallback, new SanityOracle(), sink, new FeedStateMachine(), {
      now: () => 1,
    });
    orch.start();
    orch.notifyPrimaryLost();
    orch.notifyReconnectExhausted();
    expect(sink.statuses.at(-1)?.connection).toBe("degraded");

    fallback.emit(tick("YAHOO", "delayed", 99));
    expect(sink.ticks).toHaveLength(1);
    expect(sink.ticks[0]?.freshness).toBe("delayed");
  });

  test("sustained oracle divergence degrades the feed", () => {
    const sink = new FakeSink();
    const primary = new FakeAdapter("ls");
    const fallback = new FakeAdapter("yahoo");
    const orch = new FeedOrchestrator(
      primary,
      fallback,
      new SanityOracle({ thresholdPct: 2, window: 2 }),
      sink,
      new FeedStateMachine(),
      { now: () => 1 },
    );
    orch.start();
    fallback.emit(tick("YAHOO", "delayed", 100)); // reference
    primary.emit(tick("L&S", "live", 120)); // diverged 1
    primary.emit(tick("L&S", "live", 121)); // diverged 2 → sustained
    expect(sink.statuses.at(-1)?.connection).toBe("degraded");
  });
});
