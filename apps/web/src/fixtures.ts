import type { Position } from "@cancri/data-contracts";
import { DEFAULT_HOLDINGS, ACCENT_PALETTE, type SimSeed } from "@cancri/sim-source";
import type { DemoPosition } from "./state.js";

/**
 * Phase-1 demo fixtures. These stand in for the user's confirmed, ISIN-verified
 * inventory and the Gemini onboarding thread until Phases 2–3 wire the real
 * pipeline. The dashboard holdings and the confirm proposal are intentionally
 * separate sets, exactly as the design reference seeds them.
 */

/** Build the dashboard inventory from the demo holdings (accent by palette index). */
export function buildDemoInventory(): DemoPosition[] {
  return DEFAULT_HOLDINGS.map((h, i) => {
    const accent = ACCENT_PALETTE[i % ACCENT_PALETTE.length] ?? "#7b5cff";
    const pos: DemoPosition = {
      isin: h.ticker, // Phase-1 stand-in; a real ISIN arrives in Phase 4.
      symbol: h.ticker,
      name: h.name,
      quantity: h.quantity,
      source: h.source,
      accent,
      logoState: h.logoState,
    };
    return pos;
  });
}

/** Seeds for the simulator (previous close + base freshness per instrument). */
export function buildSimSeeds(): SimSeed[] {
  return DEFAULT_HOLDINGS.map((h) => ({
    instrumentId: h.ticker,
    previousClose: h.previousClose,
    source: h.source,
    freshness: h.freshness,
  }));
}

export type ProposalRow = Pick<Position, "name" | "symbol"> & {
  quantity: number;
  confidence: number;
  source: string;
};

/** Confirm-screen proposal (the handover seeds 7 rows, 1 flagged). */
export const DEFAULT_PROPOSAL: readonly ProposalRow[] = [
  { name: "Apple Inc.", symbol: "AAPL", quantity: 42, confidence: 0.99, source: "NASDAQ" },
  { name: "NVIDIA Corp.", symbol: "NVDA", quantity: 30, confidence: 0.97, source: "NASDAQ" },
  { name: "Microsoft Corp.", symbol: "MSFT", quantity: 18, confidence: 0.98, source: "NASDAQ" },
  { name: "Tesla Inc.", symbol: "TSLA", quantity: 25, confidence: 0.95, source: "NASDAQ" },
  { name: "Bitcoin", symbol: "BTC", quantity: 0.75, confidence: 0.93, source: "COINBASE" },
  { name: "Palantir Tech.", symbol: "PLTR", quantity: 120, confidence: 0.62, source: "NYSE" },
  { name: "Amazon.com", symbol: "AMZN", quantity: 20, confidence: 0.41, source: "NASDAQ" },
];

export interface ChatMessage {
  readonly role: "user" | "bot";
  readonly text: string;
}

export const DEFAULT_CHAT: readonly ChatMessage[] = [
  {
    role: "user",
    text: "12 aapl, 0.5 btc, a hundred msft shares, ~30 nvidia, palantir 120, and some amazon",
  },
  {
    role: "bot",
    text: "parsed 7 instruments. 2 need your eye → AMZN (qty unclear: \"some\") and PLTR (confirm 120?). resolving symbols & logos…",
  },
  {
    role: "bot",
    text: "normalised inventory ready. hit parse to review the proposal before anything goes live.",
  },
];

export interface BootLine {
  readonly tag: string;
  readonly text: string;
  readonly ok: string;
}

export const BOOT_LINES: readonly BootLine[] = [
  { tag: "[ok]", text: "cancri // live-portfolio-terminal", ok: "online" },
  { tag: "[net]", text: "establishing socket → primary feed", ok: "handshake" },
  { tag: "[net]", text: "subscribing instruments · L1 quotes", ok: "" },
  { tag: "[llm]", text: "gemini intake channel ready", ok: "" },
  { tag: "[ok]", text: "freshness monitor armed · live/delayed", ok: "" },
  { tag: "[ok]", text: "terminal ready", ok: "✓" },
];
