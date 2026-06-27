import type { ProposedPosition } from "@cancri/data-contracts";
import { isValidIsin } from "./isin.js";
import { extractText, type RawInput } from "./parse.js";
import { getGeminiClient, type GeminiClient, type RawProposal } from "./gemini.js";

/**
 * The normalisation pipeline (brief §B, ADR-0007): extract text from any of the
 * four inputs → Gemini proposes → a deterministic gate disposes. A proposed ISIN
 * is trusted only if it passes the checksum; an unverified identity caps the
 * row's confidence so the UI flags it for the user's eye.
 */
export async function normaliseInventory(
  input: RawInput,
  client: GeminiClient = getGeminiClient(),
): Promise<ProposedPosition[]> {
  const text = await extractText(input);
  const raw = await client.normalise(text);
  return raw.map(gate);
}

const FLAG_THRESHOLD = 0.69; // below 0.7 the confirm screen flags the row

function gate(r: RawProposal): ProposedPosition {
  let confidence = Math.max(0, Math.min(1, r.confidence));
  let isin = r.isin;
  let note = r.uncertaintyNote;

  if (isin !== undefined && !isValidIsin(isin)) {
    note = appendNote(note, `proposed ISIN "${isin}" failed checksum and was dropped`);
    isin = undefined;
    confidence = Math.min(confidence, 0.6);
  }
  if (isin === undefined) {
    // No verified identity yet (e.g. crypto, or awaiting the Phase-4 resolver).
    confidence = Math.min(confidence, FLAG_THRESHOLD);
  }

  return {
    name: r.name,
    symbol: r.symbol,
    quantity: r.quantity,
    confidence,
    source: "gemini",
    ...(isin !== undefined ? { isin } : {}),
    ...(r.costBasis !== undefined ? { costBasis: r.costBasis } : {}),
    ...(note !== undefined ? { uncertaintyNote: note } : {}),
  };
}

function appendNote(existing: string | undefined, add: string): string {
  return existing !== undefined && existing !== "" ? `${existing}; ${add}` : add;
}
