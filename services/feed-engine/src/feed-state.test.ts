import { describe, expect, test } from "vitest";
import { FeedStateMachine, deriveStatus } from "./feed-state.js";

describe("FeedStateMachine (degradation, brief §C/§F)", () => {
  test("live → reconnect → degraded on primary loss", () => {
    const fsm = new FeedStateMachine({ maxReconnectAttempts: 5 });
    expect(fsm.state).toBe("live");
    expect(fsm.dispatch({ type: "primary_lost" })).toBe("reconnect");
    expect(fsm.attempt).toBe(1);
    expect(fsm.dispatch({ type: "reconnect_exhausted" })).toBe("degraded");
  });

  test("recovery is hysteretic (needs several sane ticks)", () => {
    const fsm = new FeedStateMachine({ recoverAfter: 3 });
    fsm.dispatch({ type: "primary_lost" });
    fsm.dispatch({ type: "reconnect_exhausted" });
    expect(fsm.dispatch({ type: "sane_tick" })).toBe("degraded");
    expect(fsm.dispatch({ type: "sane_tick" })).toBe("degraded");
    expect(fsm.dispatch({ type: "sane_tick" })).toBe("live"); // 3rd sane → recover
  });

  test("market closed/open and error/retry", () => {
    const fsm = new FeedStateMachine();
    expect(fsm.dispatch({ type: "market_closed" })).toBe("closed");
    expect(fsm.dispatch({ type: "market_open" })).toBe("live");
    expect(fsm.dispatch({ type: "error" })).toBe("error");
    expect(fsm.dispatch({ type: "retry" })).toBe("live");
  });

  test("deriveStatus reflects the state + reconnect attempts", () => {
    const fsm = new FeedStateMachine();
    fsm.dispatch({ type: "primary_lost" });
    const s = deriveStatus(fsm, { ticks: 7, latencyMs: 200 }, 123);
    expect(s.connection).toBe("reconnect");
    expect(s.reconnectAttempt).toBe(1);
    expect(s.ticks).toBe(7);

    fsm.dispatch({ type: "reconnect_exhausted" });
    const d = deriveStatus(fsm, { ticks: 8, latencyMs: 220 }, 124);
    expect(d.connection).toBe("degraded");
    expect(d.feedNote).toContain("fallback");
  });
});
