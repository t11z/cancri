import { describe, expect, test } from "vitest";
import { PROTOCOL_CONFIG_V1, verifyFixture } from "@cancri/ls-protocol";
import {
  fixturePath,
  parseFixture,
  serializeFixture,
  toProtocolFixture,
  type CapturedFixture,
} from "./corpus.js";

const FIXTURE: CapturedFixture = {
  capturedAt: "2026-06-27T09:30:00Z",
  protocolVersion: "v1",
  frames: ["U,LS00042,212.40", "U,LS00777,61240.00"],
  renderedPrices: [
    { id: "LS00042", price: 212.4 },
    { id: "LS00777", price: 61240.0 },
  ],
  idMap: { LS00042: "US0378331005", LS00777: "XBT" },
};

describe("fixture corpus (brief §D)", () => {
  test("serialize → parse round-trips", () => {
    const parsed = parseFixture(serializeFixture(FIXTURE));
    expect(parsed).toEqual(FIXTURE);
  });

  test("rejects malformed json", () => {
    expect(() => parseFixture("{}")).toThrow();
  });

  test("path is append-only by capture timestamp", () => {
    expect(fixturePath(FIXTURE.capturedAt)).toBe("fixtures/ls-protocol/2026-06-27T09:30:00Z/fixture.json");
  });

  test("a captured fixture verifies against the active config (it documents the protocol)", () => {
    expect(verifyFixture(toProtocolFixture(FIXTURE, PROTOCOL_CONFIG_V1))).toBe(true);
  });
});
