import type { Freshness, LogoState } from "@cancri/data-contracts";

/**
 * Demo instruments for the Phase-1 local slice — the same twelve the design
 * reference seeds, so the simulator reproduces the handover's dashboard exactly.
 * In Phase 3+ this is replaced by the user's confirmed, ISIN-verified inventory.
 */
export interface DemoHolding {
  /** Stand-in instrument id for the simulator (a real ISIN arrives in Phase 4). */
  readonly ticker: string;
  readonly name: string;
  readonly quantity: number;
  readonly previousClose: number;
  readonly logoState: LogoState;
  readonly source: string;
  /** Baseline per-instrument freshness; `degraded` forces all rows to delayed. */
  readonly freshness: Freshness;
}

export const DEFAULT_HOLDINGS: readonly DemoHolding[] = [
  { ticker: "AAPL", name: "Apple Inc.", quantity: 42, previousClose: 212.4, logoState: "resolved", source: "NASDAQ", freshness: "live" },
  { ticker: "NVDA", name: "NVIDIA Corp.", quantity: 30, previousClose: 128.3, logoState: "resolved", source: "NASDAQ", freshness: "live" },
  { ticker: "MSFT", name: "Microsoft Corp.", quantity: 18, previousClose: 447.1, logoState: "resolved", source: "NASDAQ", freshness: "live" },
  { ticker: "TSLA", name: "Tesla Inc.", quantity: 25, previousClose: 243.8, logoState: "resolved", source: "NASDAQ", freshness: "live" },
  { ticker: "BTC", name: "Bitcoin", quantity: 0.75, previousClose: 61240, logoState: "resolved", source: "COINBASE", freshness: "live" },
  { ticker: "ETH", name: "Ethereum", quantity: 6.2, previousClose: 3380, logoState: "resolved", source: "KRAKEN", freshness: "live" },
  { ticker: "AMZN", name: "Amazon.com", quantity: 20, previousClose: 186.4, logoState: "resolved", source: "NASDAQ", freshness: "live" },
  { ticker: "GOOGL", name: "Alphabet Inc.", quantity: 15, previousClose: 178.2, logoState: "loading", source: "NASDAQ", freshness: "live" },
  { ticker: "AMD", name: "Adv. Micro Devices", quantity: 40, previousClose: 162.1, logoState: "resolved", source: "NASDAQ", freshness: "delayed" },
  { ticker: "PLTR", name: "Palantir Tech.", quantity: 120, previousClose: 28.6, logoState: "resolved", source: "NYSE", freshness: "live" },
  { ticker: "COIN", name: "Coinbase Global", quantity: 14, previousClose: 241.3, logoState: "monogram", source: "NASDAQ", freshness: "delayed" },
  { ticker: "SPY", name: "S&P 500 ETF", quantity: 30, previousClose: 548.7, logoState: "resolved", source: "NYSE", freshness: "live" },
];

/** Handover accent_palette — decorative identity colours only (never up/down/warn). */
export const ACCENT_PALETTE: readonly string[] = [
  "#7b5cff", "#36f9d0", "#5ec6ff", "#ff5277", "#ffd23f", "#ff8a4c",
  "#4cd4ff", "#b06cff", "#36d39b", "#ff6ba8", "#5b8cff", "#46c8a8",
];
