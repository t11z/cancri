import type { ProposedPosition } from "@cancri/data-contracts";
import { isValidIsin } from "./isin.js";
import { extractText, type RawInput } from "./parse.js";
import { getGeminiClient, type GeminiClient, type RawProposal } from "./gemini.js";
import { getIsinResolver, type IsinResolver } from "./resolve.js";

/**
 * The normalisation pipeline (brief §B, ADR-0007): extract text from any of the
 * four inputs → Gemini proposes → a deterministic gate disposes. A proposed ISIN
 * is trusted only if it passes the checksum; the validated ISIN is then the
 * canonical key, so the instrument's identity (name, symbol) is taken from a
 * resolver keyed on the ISIN — never from the model's free-text guess, which can
 * pin the wrong share class. An unverified or unconfirmable identity caps the
 * row's confidence so the UI flags it for the user's eye.
 */
export async function normaliseInventory(
  input: RawInput,
  client: GeminiClient = getGeminiClient(),
  resolver: IsinResolver = getIsinResolver(),
): Promise<ProposedPosition[]> {
  const text = await extractText(input);
  const raw = await client.normalise(text);
  return Promise.all(raw.map((r) => gate(r, resolver)));
}

const FLAG_THRESHOLD = 0.69; // below 0.7 the confirm screen flags the row

async function gate(r: RawProposal, resolver: IsinResolver): Promise<ProposedPosition> {
  let confidence = Math.max(0, Math.min(1, r.confidence));
  let isin = r.isin;
  let name = r.name;
  let symbol = r.symbol;
  let note = r.uncertaintyNote;

  if (isin !== undefined && !isValidIsin(isin)) {
    note = appendNote(note, `proposed ISIN "${isin}" failed checksum and was dropped`);
    isin = undefined;
    confidence = Math.min(confidence, 0.6);
  }

  if (isin !== undefined) {
    // ISIN is canonical (ADR-0007): derive the identity from it so the model's
    // free-text guess can't pin the wrong instrument (e.g. the distributing
    // "VWRL" for the accumulating IE00BK5BQT80).
    const resolved = await resolver.resolve(isin);
    if (resolved === null) {
      // Valid checksum but the identity couldn't be confirmed — flag it rather
      // than present the model's unverified guess as authoritative.
      note = appendNote(note, `ISIN ${isin} could not be confirmed — please verify`);
      confidence = Math.min(confidence, FLAG_THRESHOLD);
    } else {
      if (resolved.symbol.toUpperCase() !== symbol.toUpperCase()) {
        note = appendNote(note, `identity corrected from ISIN: ${symbol} → ${resolved.symbol}`);
      }
      name = resolved.name;
      symbol = resolved.symbol;
    }
  } else {
    // No verified identity (e.g. crypto, or a dropped ISIN).
    confidence = Math.min(confidence, FLAG_THRESHOLD);
  }

  return {
    name,
    symbol,
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
