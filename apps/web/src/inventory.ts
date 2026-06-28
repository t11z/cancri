import { commodityFor, type Position, type ProposedPosition } from "@cancri/data-contracts";
import { ACCENT_PALETTE, DEFAULT_HOLDINGS, type SimSeed } from "@cancri/sim-source";
import type { DemoPosition } from "./state.js";
import type { ProposalRow } from "./fixtures.js";

/**
 * Inventory mapping. In Phase 2 the confirmed proposal becomes the persisted
 * inventory and drives the dashboard. Prices are still simulated (Phase 4 brings
 * real L&S/Yahoo): we look up a previous-close seed by symbol from the demo set,
 * falling back to a neutral baseline for anything unknown.
 */
const REF = new Map(DEFAULT_HOLDINGS.map((h) => [h.ticker, h] as const));

export function inventoryFromProposal(proposal: readonly ProposalRow[]): DemoPosition[] {
  return proposal.map((r, i) => ({
    isin: r.symbol, // Phase-2 stand-in; a verified ISIN arrives with Gemini (Phase 3).
    symbol: r.symbol,
    name: r.name,
    quantity: r.quantity,
    source: r.source,
    accent: ACCENT_PALETTE[i % ACCENT_PALETTE.length] ?? "#7b5cff",
    logoState: REF.get(r.symbol)?.logoState ?? "monogram",
  }));
}

export function simSeedsFromInventory(inv: readonly DemoPosition[]): SimSeed[] {
  return inv.map((p) => {
    const ref = REF.get(p.symbol);
    // Commodities are priced per their canonical unit (ozt for metals); seed from
    // the catalogue so an added metal gets a believable price, not the 100 default.
    const commodityClose = commodityFor(p.symbol)?.referenceClose;
    return {
      instrumentId: p.isin,
      previousClose: ref?.previousClose ?? commodityClose ?? 100,
      source: p.source,
      freshness: ref?.freshness ?? "live",
    };
  });
}

/** Map Gemini's confirmed proposal into Positions (the book). ISIN falls back to
 *  the symbol as a Phase-3 stand-in until the Phase-4 resolver supplies a real one. */
export function proposalToPositions(proposal: readonly ProposedPosition[]): Position[] {
  return proposal.map((p, i) => ({
    isin: p.isin ?? p.symbol,
    symbol: p.symbol,
    name: p.name,
    quantity: p.quantity,
    source: p.source,
    accent: ACCENT_PALETTE[i % ACCENT_PALETTE.length] ?? "#7b5cff",
    ...(p.costBasis !== undefined ? { costBasis: p.costBasis } : {}),
    ...(p.unit !== undefined ? { unit: p.unit } : {}),
    ...(p.domain !== undefined ? { domain: p.domain } : {}),
  }));
}

/** Strip the view-only logo state for persistence (the book stores Positions). */
export function demoToPositions(inv: readonly DemoPosition[]): Position[] {
  return inv.map(({ isin, symbol, name, quantity, source, accent, costBasis, unit, domain }) => ({
    isin,
    symbol,
    name,
    quantity,
    source,
    accent,
    ...(costBasis !== undefined ? { costBasis } : {}),
    ...(unit !== undefined ? { unit } : {}),
    ...(domain !== undefined ? { domain } : {}),
  }));
}

/** Per-conflict disposition when an added instrument is already in the book. */
export type MergeChoice = "replace" | "add";

/** Canonical identity for matching a holding across the book and an addition:
 *  the ISIN when present, else the symbol (ADR-0007). */
const keyOf = (p: Position): string => p.isin || p.symbol;

/**
 * Merge freshly-confirmed positions into the existing book. Adding holdings is
 * not a one-shot onboarding step — it folds into the book the user already has.
 * A genuinely new instrument is appended; for one already present (same ISIN,
 * else symbol) the user's per-key choice disposes: `replace` takes the new
 * values, `add` sums the quantity onto the existing position. Existing order is
 * preserved (stable), new instruments follow. Pure — no app/DOM state.
 */
export function mergeInventory(
  existing: readonly Position[],
  additions: readonly Position[],
  choice: (key: string) => MergeChoice,
): Position[] {
  const out: Position[] = existing.map((p) => ({ ...p }));
  const index = new Map(out.map((p, i) => [keyOf(p), i] as const));
  for (const add of additions) {
    const k = keyOf(add);
    const at = index.get(k);
    const prior = at === undefined ? undefined : out[at];
    if (at === undefined || prior === undefined) {
      index.set(k, out.length);
      out.push({ ...add });
    } else if (choice(k) === "add") {
      out[at] = { ...prior, quantity: prior.quantity + add.quantity };
    } else {
      out[at] = { ...add };
    }
  }
  return out;
}

/** Re-enrich loaded Positions with a logo state for rendering. */
export function positionsToDemo(positions: readonly Position[]): DemoPosition[] {
  return positions.map((p) => ({
    ...p,
    logoState: REF.get(p.symbol)?.logoState ?? "monogram",
  }));
}
