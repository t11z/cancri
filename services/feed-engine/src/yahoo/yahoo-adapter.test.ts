import { describe, expect, test } from "vitest";
import type { Tick } from "@cancri/data-contracts";
import { YahooSourceAdapter } from "./yahoo-adapter.js";
import { encodeYahooFrame } from "./proto.js";

describe("YahooSourceAdapter", () => {
  test("decodes a protobuf frame to a DELAYED Tick", () => {
    const adapter = new YahooSourceAdapter({
      isinForYahooId: (id) => (id === "BAY.DE" ? "DE000BAY0017" : undefined),
      previousClose: () => 27.0,
      now: () => 1000,
    });
    const got: Tick[] = [];
    adapter.onTick((t) => got.push(t));

    adapter.handleFrame(encodeYahooFrame({ id: "BAY.DE", price: 27.31, exchange: "GER" }));

    expect(got).toHaveLength(1);
    expect(got[0]?.instrumentId).toBe("DE000BAY0017");
    expect(got[0]?.lastPrice).toBeCloseTo(27.31, 2);
    expect(got[0]?.source).toBe("YAHOO");
    expect(got[0]?.freshness).toBe("delayed"); // always delayed
  });

  test("drops unknown ids", () => {
    const adapter = new YahooSourceAdapter({
      isinForYahooId: () => undefined,
      previousClose: () => 0,
    });
    const got: Tick[] = [];
    adapter.onTick((t) => got.push(t));
    adapter.handleFrame(encodeYahooFrame({ id: "ZZZ.DE", price: 1 }));
    expect(got).toHaveLength(0);
  });
});
