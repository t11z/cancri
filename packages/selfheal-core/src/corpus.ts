import type { ProtocolConfig, ProtocolFixture } from "@cancri/ls-protocol";

/**
 * The append-only fixture corpus (brief §D). Each capture pairs the raw protocol
 * frames with the prices SIMULTANEOUSLY rendered on the live page — ground truth
 * from the same source, same moment. The corpus is both protocol-documentation-
 * by-example and the regression base: a proposed config is correct iff its replay
 * reproduces `renderedPrices` from `frames`.
 */
export interface CapturedFixture {
  /** UTC timestamp of the capture (passed in — never generated here). */
  readonly capturedAt: string;
  /** The protocol version that was active when this was captured. */
  readonly protocolVersion: string;
  /** Raw frame lines recorded off the socket. */
  readonly frames: readonly string[];
  /** Prices rendered on the page at capture time, in frame order (ground truth). */
  readonly renderedPrices: ReadonlyArray<{ id: string; price: number }>;
  /** Source-internal id → ISIN at capture time. */
  readonly idMap: Readonly<Record<string, string>>;
}

export function fixturePath(capturedAt: string): string {
  return `fixtures/ls-protocol/${capturedAt}/fixture.json`;
}

export function serializeFixture(fixture: CapturedFixture): string {
  return JSON.stringify(fixture, null, 2) + "\n";
}

export function parseFixture(json: string): CapturedFixture {
  const obj = JSON.parse(json) as Partial<CapturedFixture>;
  if (
    typeof obj.capturedAt !== "string" ||
    typeof obj.protocolVersion !== "string" ||
    !Array.isArray(obj.frames) ||
    !Array.isArray(obj.renderedPrices) ||
    typeof obj.idMap !== "object" ||
    obj.idMap === null
  ) {
    throw new Error("invalid CapturedFixture");
  }
  return obj as CapturedFixture;
}

/** Turn a captured fixture + a candidate config into the replay gate's input. */
export function toProtocolFixture(captured: CapturedFixture, config: ProtocolConfig): ProtocolFixture {
  return {
    config,
    frames: captured.frames,
    expected: captured.renderedPrices.map((p) => ({ id: p.id, price: p.price })),
  };
}
