/**
 * Curated symbol → primary-domain map for brand-logo resolution (ADR-0014). The
 * domain feeds the logo provider; an instrument with no known domain (most crypto,
 * commodities, broad ETFs) stays a monogram by design — we never guess a domain.
 * Gemini may also attach a `domain` to a proposed position, which takes precedence.
 */
const KNOWN_DOMAINS: Record<string, string> = {
  AAPL: "apple.com",
  NVDA: "nvidia.com",
  MSFT: "microsoft.com",
  TSLA: "tesla.com",
  AMZN: "amazon.com",
  GOOGL: "abc.xyz",
  GOOG: "abc.xyz",
  AMD: "amd.com",
  PLTR: "palantir.com",
  COIN: "coinbase.com",
  META: "meta.com",
  NFLX: "netflix.com",
  AVGO: "broadcom.com",
  INTC: "intel.com",
  ORCL: "oracle.com",
  CRM: "salesforce.com",
  ADBE: "adobe.com",
  UBER: "uber.com",
  SHOP: "shopify.com",
  PYPL: "paypal.com",
};

/** Primary domain for a symbol (case-insensitive), or undefined → monogram. */
export function domainForSymbol(symbol: string): string | undefined {
  return KNOWN_DOMAINS[symbol.trim().toUpperCase()];
}
