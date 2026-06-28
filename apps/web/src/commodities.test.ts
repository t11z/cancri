import { describe, expect, test } from "vitest";
import { canonicalQuantity, commodityFor, convertQuantity } from "@cancri/data-contracts";

describe("commodity units (precious metals)", () => {
  test("resolves catalogue symbols and common aliases, case-insensitively", () => {
    expect(commodityFor("XAU")?.name).toBe("Gold");
    expect(commodityFor("gold")?.symbol).toBe("XAU");
    expect(commodityFor("Silver")?.symbol).toBe("XAG");
    expect(commodityFor("AAPL")).toBeUndefined();
  });

  test("canonical quantity converts the held unit into priced troy ounces", () => {
    const gold = commodityFor("XAU")!;
    expect(canonicalQuantity(gold, 1, "ozt")).toBeCloseTo(1, 6);
    // 31.1034768 g == 1 troy ounce
    expect(canonicalQuantity(gold, 31.1034768, "g")).toBeCloseTo(1, 6);
    expect(canonicalQuantity(gold, 1, "kg")).toBeCloseTo(32.1507, 3);
  });

  test("an absent unit values at the canonical unit (troy ounce)", () => {
    const gold = commodityFor("XAU")!;
    expect(canonicalQuantity(gold, 2, undefined)).toBeCloseTo(2, 6);
  });

  test("switching units preserves the physical amount (and thus value)", () => {
    const gold = commodityFor("XAU")!;
    // 10 troy ounces expressed in grams
    expect(convertQuantity(gold, 10, "ozt", "g")).toBeCloseTo(311.034768, 4);
    // round-trip is identity
    const grams = convertQuantity(gold, 10, "ozt", "g");
    expect(convertQuantity(gold, grams, "g", "ozt")).toBeCloseTo(10, 6);
    // 1 kg expressed in grams
    expect(convertQuantity(gold, 1, "kg", "g")).toBeCloseTo(1000, 6);
  });
});
