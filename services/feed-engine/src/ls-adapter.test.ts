import { describe, expect, test } from "vitest";
import type { Tick } from "@cancri/data-contracts";
import { LsSourceAdapter } from "./ls-adapter.js";

describe("LsSourceAdapter — frame to normalised Tick", () => {
  const make = () =>
    new LsSourceAdapter({
      isinForId: (id) => (id === "LS00042" ? "US0378331005" : undefined),
      previousClose: () => 210,
      now: () => 1000,
    });

  test("decodes a frame and emits a normalised Tick with hub-computed day change", () => {
    const adapter = make();
    const got: Tick[] = [];
    adapter.onTick((t) => got.push(t));

    adapter.handleFrame("U,LS00042,212.40");

    expect(got).toHaveLength(1);
    expect(got[0]?.instrumentId).toBe("US0378331005");
    expect(got[0]?.lastPrice).toBe(212.4);
    expect(got[0]?.previousClose).toBe(210);
    expect(got[0]?.dayChangeAbs).toBeCloseTo(2.4);
    expect(got[0]?.source).toBe("L&S");
    expect(got[0]?.freshness).toBe("live");
  });

  test("ignores noise and unknown instrument ids (no leak)", () => {
    const adapter = make();
    const got: Tick[] = [];
    adapter.onTick((t) => got.push(t));
    adapter.handleFrame("noise");
    adapter.handleFrame("U,LS99999,1.00"); // unknown id → no ISIN → dropped
    expect(got).toHaveLength(0);
  });
});
