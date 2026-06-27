import { describe, expect, test } from "vitest";
import { SanityOracle } from "./sanity-oracle.js";

describe("SanityOracle (brief §D)", () => {
  test("does not trip on prices within threshold", () => {
    const oracle = new SanityOracle({ thresholdPct: 2, window: 3 });
    expect(oracle.observe("X", 100, 101)).toBe(false);
    expect(oracle.observe("X", 100.5, 101)).toBe(false);
    expect(oracle.observe("X", 100, 100.5)).toBe(false);
  });

  test("does not trip on a single outlier (Yahoo lag tolerance)", () => {
    const oracle = new SanityOracle({ thresholdPct: 2, window: 3 });
    expect(oracle.observe("X", 100, 100)).toBe(false);
    expect(oracle.observe("X", 120, 100)).toBe(false); // one big move
    expect(oracle.observe("X", 100, 100)).toBe(false);
  });

  test("trips on sustained divergence over the window", () => {
    const oracle = new SanityOracle({ thresholdPct: 2, window: 3 });
    expect(oracle.observe("X", 120, 100)).toBe(false);
    expect(oracle.observe("X", 121, 100)).toBe(false);
    expect(oracle.observe("X", 122, 100)).toBe(true); // sustained → trip
  });

  test("recovers when divergence clears", () => {
    const oracle = new SanityOracle({ thresholdPct: 2, window: 2 });
    expect(oracle.observe("X", 120, 100)).toBe(false);
    expect(oracle.observe("X", 121, 100)).toBe(true);
    expect(oracle.observe("X", 100, 100)).toBe(false); // back in line
  });
});
