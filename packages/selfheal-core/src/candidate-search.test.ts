import { describe, expect, test } from "vitest";
import { PROTOCOL_CONFIG_V1 } from "@cancri/ls-protocol";
import { searchProtocolFix } from "./candidate-search.js";
import type { CapturedFixture } from "./corpus.js";

describe("searchProtocolFix — bounded break-surface search (ADR-0009 / ADR-0010)", () => {
  test("recovers a shifted price field from the captured ground truth", () => {
    // A protocol change moved the price to field 3 (an EXTRA field appeared).
    const captured: CapturedFixture = {
      capturedAt: "2026-06-27T00:00:00Z",
      protocolVersion: "v1",
      frames: ["U,LS00042,EXTRA,212.40", "U,LS00777,EXTRA,61240.00"],
      renderedPrices: [
        { id: "LS00042", price: 212.4 },
        { id: "LS00777", price: 61240.0 },
      ],
      idMap: { LS00042: "US0378331005", LS00777: "XBT" },
    };

    const fix = searchProtocolFix(PROTOCOL_CONFIG_V1, captured);
    expect(fix).not.toBeNull();
    expect(fix?.frame.idField).toBe(1);
    expect(fix?.frame.priceField).toBe(3);
  });

  test("returns null when nothing in the bounded space reproduces the prices", () => {
    const captured: CapturedFixture = {
      capturedAt: "2026-06-27T00:00:00Z",
      protocolVersion: "v1",
      frames: ["U,LS00042,212.40"],
      renderedPrices: [{ id: "LS00042", price: 999.99 }], // unreachable from the frame
      idMap: { LS00042: "US0378331005" },
    };
    expect(searchProtocolFix(PROTOCOL_CONFIG_V1, captured)).toBeNull();
  });
});
