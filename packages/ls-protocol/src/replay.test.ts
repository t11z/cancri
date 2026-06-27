import { describe, expect, test } from "vitest";
import { PROTOCOL_CONFIG_V1, decodeFrame, makeProtocolModule } from "./index.js";
import { replay, verifyFixture, type ProtocolFixture } from "./replay.js";

const FRAMES = ["U,LS00042,212.40\r\n", "U,LS00777,61240.00\r\n", "noise line", "U,LS00042,212.55\r\n"];
const EXPECTED = [
  { id: "LS00042", price: 212.4 },
  { id: "LS00777", price: 61240.0 },
  { id: "LS00042", price: 212.55 },
];

describe("ls-protocol replay (ADR-0009 / ADR-0010)", () => {
  test("decodeFrame parses updates and ignores noise", () => {
    expect(decodeFrame(PROTOCOL_CONFIG_V1, "U,LS00042,212.40")).toEqual({ id: "LS00042", price: 212.4 });
    expect(decodeFrame(PROTOCOL_CONFIG_V1, "noise")).toBeNull();
  });

  test("replay reproduces rendered prices with the matching config", () => {
    expect(replay(PROTOCOL_CONFIG_V1, FRAMES)).toEqual(EXPECTED);
    const fixture: ProtocolFixture = { config: PROTOCOL_CONFIG_V1, frames: FRAMES, expected: EXPECTED };
    expect(verifyFixture(fixture)).toBe(true);
  });

  test("a wrong frame layout fails the gate (regression catch)", () => {
    const broken = { ...PROTOCOL_CONFIG_V1, frame: { ...PROTOCOL_CONFIG_V1.frame, priceField: 1 } };
    const fixture: ProtocolFixture = { config: broken, frames: FRAMES, expected: EXPECTED };
    expect(verifyFixture(fixture)).toBe(false);
  });

  test("buildCreateSession carries the handshake magic values", () => {
    const body = makeProtocolModule(PROTOCOL_CONFIG_V1).buildCreateSession({ user: "trader" });
    expect(body).toContain("LS_adapter_set=WALLSTREETONLINE");
    expect(body).toContain("LS_cid=");
    expect(body).toContain("LS_user=trader");
  });
});
