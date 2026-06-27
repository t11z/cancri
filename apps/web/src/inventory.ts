import type { Position } from "@cancri/data-contracts";
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
    return {
      instrumentId: p.isin,
      previousClose: ref?.previousClose ?? 100,
      source: p.source,
      freshness: ref?.freshness ?? "live",
    };
  });
}

/** Strip the view-only logo state for persistence (the book stores Positions). */
export function demoToPositions(inv: readonly DemoPosition[]): Position[] {
  return inv.map(({ isin, symbol, name, quantity, source, accent }) => ({
    isin,
    symbol,
    name,
    quantity,
    source,
    accent,
  }));
}

/** Re-enrich loaded Positions with a logo state for rendering. */
export function positionsToDemo(positions: readonly Position[]): DemoPosition[] {
  return positions.map((p) => ({
    ...p,
    logoState: REF.get(p.symbol)?.logoState ?? "monogram",
  }));
}
