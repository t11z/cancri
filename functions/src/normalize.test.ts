import { describe, expect, test } from "vitest";
import { normaliseInventory } from "./normalize.js";
import { MockGemini, type GeminiClient, type RawProposal } from "./gemini.js";
import {
  MockIsinResolver,
  MockPriceFetcher,
  type IsinResolver,
  type PriceFetcher,
  type ResolvedInstrument,
} from "./resolve.js";

const stub = (rows: RawProposal[]): GeminiClient => ({
  normalise: async () => rows,
});

// A resolver that returns a fixed identity for any ISIN (or null to model an
// instrument the search source can't confirm).
const resolverOf = (id: ResolvedInstrument | null): IsinResolver => ({
  resolve: async () => id,
});

const mock = new MockIsinResolver();
// Offline price fetcher so tests never reach the network (mirrors the resolver).
const mockPrices = new MockPriceFetcher();
const prices: PriceFetcher = (symbol) => mockPrices.fetch(symbol);

describe("normaliseInventory — deterministic gate over the LLM proposal", () => {
  test("keeps a valid proposed ISIN and high confidence", async () => {
    const res = await normaliseInventory(
      { kind: "text", content: "x" },
      stub([{ name: "Apple Inc.", symbol: "AAPL", isin: "US0378331005", quantity: 42, confidence: 0.95 }]),
      mock,
      prices,
    );
    expect(res[0]?.isin).toBe("US0378331005");
    expect(res[0]?.confidence).toBeCloseTo(0.95);
  });

  test("drops an ISIN that fails the checksum and caps confidence", async () => {
    const res = await normaliseInventory(
      { kind: "text", content: "x" },
      stub([{ name: "Apple Inc.", symbol: "AAPL", isin: "US0378331004", quantity: 42, confidence: 0.99 }]),
      mock,
      prices,
    );
    expect(res[0]?.isin).toBeUndefined();
    expect(res[0]?.confidence).toBeLessThanOrEqual(0.6);
    expect(res[0]?.uncertaintyNote).toMatch(/checksum/);
  });

  test("flags a row with no ISIN (e.g. crypto) below the review threshold", async () => {
    const res = await normaliseInventory(
      { kind: "text", content: "x" },
      stub([{ name: "Bitcoin", symbol: "BTC", quantity: 0.5, confidence: 0.92 }]),
      mock,
      prices,
    );
    expect(res[0]?.isin).toBeUndefined();
    expect(res[0]?.confidence).toBeLessThan(0.7);
  });

  test("the ISIN is canonical: a wrong share class is corrected from it (VWRL → VWCE)", async () => {
    const res = await normaliseInventory(
      { kind: "text", content: "x" },
      stub([
        {
          name: "Vanguard FTSE All-World UCITS ETF (USD) Distributing",
          symbol: "VWRL",
          isin: "IE00BK5BQT80",
          quantity: 8.41949,
          confidence: 0.82,
        },
      ]),
      mock,
      prices,
    );
    expect(res[0]?.isin).toBe("IE00BK5BQT80");
    expect(res[0]?.symbol).toBe("VWCE");
    expect(res[0]?.name).not.toMatch(/distributing/i);
    expect(res[0]?.uncertaintyNote).toMatch(/corrected/i);
    // A confirmed ISIN stays high-confidence — the correction is surfaced, not flagged.
    expect(res[0]?.confidence).toBeCloseTo(0.82);
  });

  test("flags a valid ISIN whose identity the resolver cannot confirm", async () => {
    const res = await normaliseInventory(
      { kind: "text", content: "x" },
      stub([{ name: "Obscure Co.", symbol: "OBS", isin: "US5949181045", quantity: 5, confidence: 0.95 }]),
      resolverOf(null),
      prices,
    );
    expect(res[0]?.isin).toBe("US5949181045"); // valid checksum — kept
    expect(res[0]?.confidence).toBeLessThan(0.7);
    expect(res[0]?.uncertaintyNote).toMatch(/could not be confirmed/i);
  });

  test("MockGemini parses a simple chat line end-to-end (text path)", async () => {
    const res = await normaliseInventory(
      { kind: "text", content: "12 AAPL, 0.5 BTC, 30 NVDA" },
      new MockGemini(),
      mock,
      prices,
    );
    const bySymbol = new Map(res.map((p) => [p.symbol, p]));
    expect(bySymbol.get("AAPL")?.quantity).toBe(12);
    expect(bySymbol.get("AAPL")?.isin).toBe("US0378331005");
    expect(bySymbol.get("NVDA")?.quantity).toBe(30);
    // BTC has no ISIN → flagged for review
    expect(bySymbol.get("BTC")?.isin).toBeUndefined();
    expect(bySymbol.get("BTC")?.confidence).toBeLessThan(0.7);
  });

  test("attaches a reference price and its native currency for a resolved instrument", async () => {
    const res = await normaliseInventory(
      { kind: "text", content: "x" },
      stub([{ name: "Apple Inc.", symbol: "AAPL", isin: "US0378331005", quantity: 42, confidence: 0.95 }]),
      mock,
      prices,
    );
    expect(res[0]?.referencePrice).toBeCloseTo(212.4);
    expect(res[0]?.currency).toBe("USD");
  });

  test("carries a non-USD quote currency through (EUR-listed instrument)", async () => {
    const res = await normaliseInventory(
      { kind: "text", content: "x" },
      stub([{ name: "Vanguard FTSE All-World", symbol: "VWRL", isin: "IE00BK5BQT80", quantity: 8, confidence: 0.9 }]),
      mock,
      prices,
    );
    expect(res[0]?.symbol).toBe("VWCE");
    expect(res[0]?.referencePrice).toBeCloseTo(137.4);
    expect(res[0]?.currency).toBe("EUR");
  });

  test("omits the price fields when no quote is available (degrades, never wrong)", async () => {
    const noPrice: PriceFetcher = async () => null;
    const res = await normaliseInventory(
      { kind: "text", content: "x" },
      stub([{ name: "Apple Inc.", symbol: "AAPL", isin: "US0378331005", quantity: 42, confidence: 0.95 }]),
      mock,
      noPrice,
    );
    expect(res[0]?.referencePrice).toBeUndefined();
    expect(res[0]?.currency).toBeUndefined();
  });
});
