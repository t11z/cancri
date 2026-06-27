import { describe, expect, test } from "vitest";
import { isValidIsin } from "./isin.js";

describe("isValidIsin (Luhn check-digit, ADR-0007)", () => {
  test.each([
    ["US0378331005", "Apple"],
    ["US5949181045", "Microsoft"],
    ["US0231351067", "Amazon"],
    ["US67066G1040", "NVIDIA"],
    ["US69608A1088", "Palantir"],
    ["DE000BAY0017", "Bayer"],
    ["GB0002634946", "BAE Systems"],
  ])("accepts valid ISIN %s (%s)", (isin) => {
    expect(isValidIsin(isin)).toBe(true);
  });

  test.each([
    ["US0378331004", "wrong check digit"],
    ["US0378331015", "transposed digit"],
    ["AAPL", "not an ISIN"],
    ["US037833100", "too short"],
    ["us0378331005", "lowercase"],
    ["1S0378331005", "bad country code"],
    ["", "empty"],
  ])("rejects %s (%s)", (isin) => {
    expect(isValidIsin(isin)).toBe(false);
  });
});
