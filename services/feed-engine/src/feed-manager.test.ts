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
import { FeedManager } from "./feed-manager.js";
import type { TickSink } from "./rtdb-writer.js";

class FakeAdapter implements SourceAdapter {
  readonly name = "fake";
  subscribed: string[] = [];
  unsubscribed: string[] = [];
  started = false;
  private tick: TickListener | null = null;
  subscribe(ids: readonly string[]): void {
    this.subscribed.push(...ids);
  }
  unsubscribe(ids: readonly string[]): void {
    this.unsubscribed.push(...ids);
  }
  onTick(l: TickListener): Unsubscribe {
    this.tick = l;
    return () => {
      this.tick = null;
    };
  }
  onStatus(_l: StatusListener): Unsubscribe {
    return () => {};
  }
  start(): void {
    this.started = true;
  }
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

describe("FeedManager", () => {
  test("setUniverse subscribes/unsubscribes only the diff (tapped once)", () => {
    const adapter = new FakeAdapter();
    const fm = new FeedManager(adapter, new FakeSink());
    fm.setUniverse(["A", "B"]);
    expect(adapter.subscribed).toEqual(["A", "B"]);
    fm.setUniverse(["B", "C"]);
    expect(adapter.subscribed).toEqual(["A", "B", "C"]);
    expect(adapter.unsubscribed).toEqual(["A"]);
    expect(fm.universe.sort()).toEqual(["B", "C"]);
  });

  test("routes ticks from the source to the sink (sole writer)", () => {
    const adapter = new FakeAdapter();
    const sink = new FakeSink();
    new FeedManager(adapter, sink).start();
    expect(adapter.started).toBe(true);
    adapter.emit(
      makeTick({
        instrumentId: "US0378331005",
        lastPrice: 212.4,
        previousClose: 210,
        timestamp: 1,
        source: "L&S",
        freshness: "live",
      }),
    );
    expect(sink.ticks).toHaveLength(1);
    expect(sink.ticks[0]?.instrumentId).toBe("US0378331005");
  });
});
