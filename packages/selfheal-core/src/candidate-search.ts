import { verifyFixture, type FrameSpec, type ProtocolConfig } from "@cancri/ls-protocol";
import { toProtocolFixture, type CapturedFixture } from "./corpus.js";

const DELIMITERS = [",", ";", "|", "\t"];
const MAX_FIELD = 6;

/**
 * Search the bounded break surface for a config whose deterministic replay
 * reproduces the captured rendered prices. The FIRST config that PASSES the gate
 * is the proposed fix — the browser oracled it, not Yahoo. Bounded to exactly the
 * frame-decode axis of ADR-0009 (delimiter + id/price field indices); handshake
 * and id-map fixes extend the same shape. Returns null if nothing in the search
 * space reproduces the prices (a break beyond the bounded surface — escalate to a
 * human / LLM-drafted PR).
 */
export function searchProtocolFix(
  base: ProtocolConfig,
  captured: CapturedFixture,
): ProtocolConfig | null {
  for (const delimiter of DELIMITERS) {
    for (let idField = 0; idField <= MAX_FIELD; idField++) {
      for (let priceField = 0; priceField <= MAX_FIELD; priceField++) {
        if (idField === priceField) continue;
        const frame: FrameSpec = { ...base.frame, delimiter, idField, priceField };
        const candidate: ProtocolConfig = { ...base, version: `${base.version}-candidate`, frame };
        if (verifyFixture(toProtocolFixture(captured, candidate))) return candidate;
      }
    }
  }
  return null;
}
