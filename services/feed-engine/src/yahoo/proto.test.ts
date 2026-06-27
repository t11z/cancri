import { describe, expect, test } from "vitest";
import { decodeYahooFrame, encodeYahooFrame } from "./proto.js";

describe("Yahoo PricingData codec (Appendix B) — guard for the guard", () => {
  test("encode then decode round-trips id, price and exchange", () => {
    const frame = encodeYahooFrame({ id: "AAPL", price: 212.4, exchange: "NMS" });
    const quote = decodeYahooFrame(frame);
    expect(quote.id).toBe("AAPL");
    expect(quote.price).toBeCloseTo(212.4, 2); // float32 precision
    expect(quote.exchange).toBe("NMS");
  });

  test("decodes a German-venue quote", () => {
    const frame = encodeYahooFrame({ id: "BAY.DE", price: 27.31, exchange: "GER" });
    const quote = decodeYahooFrame(frame);
    expect(quote.id).toBe("BAY.DE");
    expect(quote.price).toBeCloseTo(27.31, 2);
  });
});
