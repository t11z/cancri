import { describe, expect, test } from "vitest";
import { probe, shouldCapture } from "./probe.js";

describe("probe (brief §D)", () => {
  test("healthy when ticks are fresh and prices sane", () => {
    expect(probe({ lastTickAgeMs: 1000, sustainedDivergence: false })).toBe("healthy");
  });
  test("stale when no tick within the liveness window", () => {
    expect(probe({ lastTickAgeMs: 20_000, sustainedDivergence: false })).toBe("stale");
  });
  test("diverged when prices drift from the reference", () => {
    expect(probe({ lastTickAgeMs: 1000, sustainedDivergence: true })).toBe("diverged");
  });

  test("capture only escalates after sustained failure", () => {
    expect(shouldCapture(2)).toBe(false);
    expect(shouldCapture(3)).toBe(true);
  });
});
