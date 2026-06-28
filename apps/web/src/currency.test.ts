import { describe, expect, test } from "vitest";
import { convert, currencyOf, fmtMoney0, fmtPrice, toUsd } from "./currency.js";

describe("display currency (indicative FX)", () => {
  test("USD is identity and the default fallback for unknown codes", () => {
    expect(convert(100, "USD")).toBe(100);
    expect(currencyOf("ZZZ").code).toBe("USD");
  });

  test("converts a USD amount by the table rate", () => {
    expect(convert(100, "EUR")).toBeCloseTo(92, 6);
    expect(convert(10, "JPY")).toBeCloseTo(1570, 6);
  });

  test("fmtMoney0 prefixes the symbol and rounds to whole units", () => {
    expect(fmtMoney0(1234.6, "USD")).toBe("$ 1,235");
    expect(fmtMoney0(100, "EUR")).toBe("€ 92");
  });

  test("fmtPrice honours per-currency fraction digits (JPY has none)", () => {
    expect(fmtPrice(212.4, "USD")).toBe("212.40");
    expect(fmtPrice(212.4, "JPY")).toBe(Math.round(212.4 * 157).toLocaleString("en-US"));
  });

  test("toUsd inverts convert so a native price normalises to the USD base", () => {
    expect(toUsd(92, "EUR")).toBeCloseTo(100, 6); // €92 ≈ $100
    expect(toUsd(100, "USD")).toBe(100); // identity
    expect(convert(toUsd(240, "EUR"), "EUR")).toBeCloseTo(240, 6); // round-trip
  });
});
