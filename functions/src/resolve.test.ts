import { describe, expect, test } from "vitest";
import {
  MockIsinResolver,
  YahooResolver,
  pickInstrument,
  type SearchFetcher,
  type YahooQuote,
} from "./resolve.js";

describe("pickInstrument — canonical identity from an ISIN's search hits", () => {
  test("prefers a real ETF ticker over the bare-ISIN local listing", () => {
    // The actual shape Yahoo returns for IE00BK5BQT80 (accumulating tranche):
    const quotes: YahooQuote[] = [
      { symbol: "VWRA.L", longname: "Vanguard FTSE All-World UCITS ETF", quoteType: "ETF", exchange: "LSE" },
      { symbol: "IE00BK5BQT80.SG", shortname: "Vanguard FTSE All-World UCITS E", quoteType: "ETF", exchange: "STU" },
    ];
    const r = pickInstrument("IE00BK5BQT80", quotes);
    expect(r).toEqual({ symbol: "VWRA", name: "Vanguard FTSE All-World UCITS ETF" });
    // Crucially: it never names the *distributing* share class.
    expect(r?.name).not.toMatch(/distributing/i);
  });

  test("strips the exchange suffix and keeps the longer name", () => {
    const r = pickInstrument("US5949181045", [
      { symbol: "MSFT.DE", shortname: "MICROSOFT", longname: "Microsoft Corporation", quoteType: "EQUITY" },
    ]);
    expect(r).toEqual({ symbol: "MSFT", name: "Microsoft Corporation" });
  });

  test("returns null when there is no usable, named candidate", () => {
    expect(pickInstrument("US5949181045", [])).toBeNull();
    expect(pickInstrument("US5949181045", [{ symbol: "MSFT" }])).toBeNull(); // no name
  });
});

describe("YahooResolver — memoised lookup over an injected fetcher", () => {
  test("resolves via the fetcher and caches per ISIN (no second call)", async () => {
    let calls = 0;
    const fetcher: SearchFetcher = async () => {
      calls += 1;
      return [{ symbol: "VWRA.L", longname: "Vanguard FTSE All-World UCITS ETF", quoteType: "ETF" }];
    };
    const r = new YahooResolver(fetcher);
    const a = await r.resolve("IE00BK5BQT80");
    const b = await r.resolve("IE00BK5BQT80");
    expect(a).toEqual({ symbol: "VWRA", name: "Vanguard FTSE All-World UCITS ETF" });
    expect(b).toEqual(a);
    expect(calls).toBe(1);
  });

  test("a fetcher that returns nothing resolves to null (degrades, never throws)", async () => {
    const r = new YahooResolver(async () => []);
    expect(await r.resolve("IE00BK5BQT80")).toBeNull();
  });
});

describe("MockIsinResolver — offline known-instrument table", () => {
  test("maps the accumulating Vanguard ISIN, not the distributing tranche", async () => {
    const r = await new MockIsinResolver().resolve("IE00BK5BQT80");
    expect(r).toEqual({ symbol: "VWCE", name: "Vanguard FTSE All-World UCITS ETF" });
  });

  test("an unknown ISIN resolves to null", async () => {
    expect(await new MockIsinResolver().resolve("XX0000000000")).toBeNull();
  });
});
