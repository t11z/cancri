/**
 * ISIN → instrument resolution (brief §B, ADR-0007: "the LLM proposes, the
 * resolver disposes"). Gemini proposes a name, symbol and ISIN freely. Once the
 * ISIN passes the checksum it is the canonical key — so the instrument's identity
 * (name, symbol) must be derived from the ISIN, never from the model's free-text
 * guess. That guess can pin the wrong share class: e.g. the *distributing* "VWRL"
 * for IE00BK5BQT80, which is in fact the *accumulating* tranche. This module
 * looks the validated ISIN up against an instrument-search source and returns the
 * canonical identity. The fetcher is injected so the selection is unit-testable;
 * the real provider is Yahoo's keyless search endpoint (`yahooSearchFetcher`),
 * which is also the runtime sanity oracle for the price layer.
 */

export interface ResolvedInstrument {
  readonly symbol: string;
  readonly name: string;
}

export interface IsinResolver {
  /** Resolve the canonical identity for a (checksum-valid) ISIN, or null when it
   *  cannot be confirmed (unknown instrument, or the source was unreachable). */
  resolve(isin: string): Promise<ResolvedInstrument | null>;
}

/** The subset of a Yahoo search "quote" we rely on. */
export interface YahooQuote {
  readonly symbol?: string;
  readonly shortname?: string;
  readonly longname?: string;
  readonly quoteType?: string;
  readonly exchange?: string;
}

/** Injected network seam: given an ISIN, return candidate quotes (never throws —
 *  a failure surfaces as an empty list so resolution degrades, not crashes). */
export type SearchFetcher = (isin: string) => Promise<readonly YahooQuote[]>;

// Symbol suffixes for German trading venues — a tiebreaker toward the user's
// home market when several listings of the same fund are returned.
const GERMAN_SUFFIXES = [".DE", ".SG", ".F", ".MU", ".BE", ".DU", ".HM", ".HA"];

/** Strip the exchange suffix Yahoo appends (`VWRA.L` → `VWRA`). */
function baseSymbol(symbol: string): string {
  const dot = symbol.lastIndexOf(".");
  return dot > 0 ? symbol.slice(0, dot) : symbol;
}

function isGermanVenue(symbol: string): boolean {
  return GERMAN_SUFFIXES.some((s) => symbol.toUpperCase().endsWith(s));
}

function bestName(q: YahooQuote): string {
  const longn = q.longname?.trim() ?? "";
  const shortn = q.shortname?.trim() ?? "";
  // Yahoo's shortname is often truncated; prefer whichever carries more signal.
  return longn.length >= shortn.length ? longn : shortn;
}

/**
 * Pick the canonical instrument for `isin` out of Yahoo's candidate quotes. We
 * score listings so a real, named ETF/equity ticker beats the bare-ISIN
 * placeholder Yahoo sometimes returns for a local venue, and prefer the home
 * market only as a tiebreaker. Exported for unit testing.
 */
export function pickInstrument(
  isin: string,
  quotes: readonly YahooQuote[],
): ResolvedInstrument | null {
  let best: { score: number; symbol: string; name: string } | null = null;
  const wantUpper = isin.toUpperCase();

  for (const q of quotes) {
    const symbol = q.symbol?.trim();
    if (symbol === undefined || symbol === "") continue;
    const name = bestName(q);
    if (name === "") continue; // an entry we can't name is no improvement
    const base = baseSymbol(symbol);

    let score = 0;
    if (base.toUpperCase() !== wantUpper) score += 4; // a real ticker, not the ISIN itself
    const type = (q.quoteType ?? "").toUpperCase();
    if (type === "ETF" || type === "EQUITY") score += 2;
    if (name.length > 0) score += 1;
    if (isGermanVenue(symbol)) score += 1; // tiebreaker toward the user's market

    if (best === null || score > best.score) best = { score, symbol: base, name };
  }

  return best === null ? null : { symbol: best.symbol, name: best.name };
}

/**
 * Real provider: Yahoo's keyless instrument search. Returns the candidate quotes
 * for an ISIN; any network/parse failure degrades to an empty list so the caller
 * flags the row for review rather than throwing the whole normalisation away.
 */
export const yahooSearchFetcher: SearchFetcher = async (isin) => {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
    isin,
  )}&quotesCount=8&newsCount=0`;
  try {
    const res = await fetch(url, {
      method: "GET",
      // A UA header keeps the unauthenticated endpoint from 403-ing.
      headers: { "User-Agent": "Mozilla/5.0 (cancri instrument resolver)" },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { quotes?: unknown };
    return Array.isArray(body.quotes) ? (body.quotes as YahooQuote[]) : [];
  } catch {
    return [];
  }
};

/**
 * Resolver backed by a search fetcher (Yahoo by default). Results are memoised
 * per ISIN for the lifetime of the instance so a portfolio that repeats an ISIN
 * — or a retried request — never re-hits the endpoint.
 */
export class YahooResolver implements IsinResolver {
  private readonly cache = new Map<string, ResolvedInstrument | null>();

  constructor(private readonly fetcher: SearchFetcher = yahooSearchFetcher) {}

  async resolve(isin: string): Promise<ResolvedInstrument | null> {
    const cached = this.cache.get(isin);
    if (cached !== undefined) return cached;
    const result = pickInstrument(isin, await this.fetcher(isin));
    this.cache.set(isin, result);
    return result;
  }
}

// A small known-instrument table for the offline path. Keyed on ISIN; covers the
// symbols the MockGemini emits plus common European holdings, so the whole
// pipeline runs deterministically without a network call.
const KNOWN: Record<string, ResolvedInstrument> = {
  US0378331005: { symbol: "AAPL", name: "Apple Inc." },
  US5949181045: { symbol: "MSFT", name: "Microsoft Corp." },
  US67066G1040: { symbol: "NVDA", name: "NVIDIA Corp." },
  US0231351067: { symbol: "AMZN", name: "Amazon.com" },
  US69608A1088: { symbol: "PLTR", name: "Palantir Tech." },
  NL0000235190: { symbol: "AIR", name: "Airbus SE" },
  US02079K3059: { symbol: "GOOGL", name: "Alphabet Inc. Class A" },
  US5801351017: { symbol: "MCD", name: "McDonald's Corp." },
  IE00BK5BQT80: { symbol: "VWCE", name: "Vanguard FTSE All-World UCITS ETF" },
};

/** Deterministic stand-in for the search resolver — offline, for tests and the
 *  Functions emulator. Unknown ISINs resolve to null (the honest "unconfirmed"). */
export class MockIsinResolver implements IsinResolver {
  async resolve(isin: string): Promise<ResolvedInstrument | null> {
    return KNOWN[isin] ?? null;
  }
}

/**
 * Pick the resolver for the current runtime — mirrors `getGeminiClient()`. The
 * real Yahoo search runs when deployed; the offline mock stands in inside the
 * Functions emulator or when explicitly disabled, so local dev and tests never
 * reach out to the network.
 */
export function getIsinResolver(): IsinResolver {
  const inEmulator = process.env["FUNCTIONS_EMULATOR"] === "true";
  const disabled = process.env["CANCRI_USE_YAHOO_RESOLVER"] === "false";
  if (inEmulator || disabled) return new MockIsinResolver();
  return new YahooResolver();
}
