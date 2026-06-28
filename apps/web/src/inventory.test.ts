import { describe, expect, test } from "vitest";
import type { Position } from "@cancri/data-contracts";
import { mergeInventory, simSeedsFromInventory } from "./inventory.js";
import type { DemoPosition } from "./state.js";

const pos = (over: Partial<Position> & Pick<Position, "symbol" | "quantity">): Position => ({
  isin: over.isin ?? over.symbol,
  symbol: over.symbol,
  name: over.name ?? over.symbol,
  quantity: over.quantity,
  source: over.source ?? "gemini",
  accent: over.accent ?? "#7b5cff",
  ...(over.costBasis !== undefined ? { costBasis: over.costBasis } : {}),
});

const demo = (over: Partial<DemoPosition> & Pick<DemoPosition, "symbol" | "quantity">): DemoPosition => ({
  ...pos(over),
  logoState: over.logoState ?? "monogram",
  ...(over.referencePrice !== undefined ? { referencePrice: over.referencePrice } : {}),
  ...(over.currency !== undefined ? { currency: over.currency } : {}),
});

const book: Position[] = [
  pos({ isin: "US0378331005", symbol: "AAPL", quantity: 12 }),
  pos({ symbol: "BTC", quantity: 0.5 }), // crypto — keyed on symbol (no ISIN)
];

describe("mergeInventory — adding holdings folds into the existing book", () => {
  test("appends a genuinely new instrument, existing order preserved", () => {
    const out = mergeInventory(book, [pos({ isin: "US67066G1040", symbol: "NVDA", quantity: 3 })], () => "replace");
    expect(out.map((p) => p.symbol)).toEqual(["AAPL", "BTC", "NVDA"]);
    expect(out[2]?.quantity).toBe(3);
  });

  test("'replace' overwrites the existing position's quantity in place", () => {
    const out = mergeInventory(book, [pos({ isin: "US0378331005", symbol: "AAPL", quantity: 40 })], () => "replace");
    expect(out).toHaveLength(2);
    expect(out[0]?.symbol).toBe("AAPL");
    expect(out[0]?.quantity).toBe(40);
  });

  test("'add' sums the quantity onto the existing position", () => {
    const out = mergeInventory(book, [pos({ isin: "US0378331005", symbol: "AAPL", quantity: 8 })], () => "add");
    expect(out[0]?.quantity).toBe(20);
  });

  test("matches a no-ISIN holding (crypto) on its symbol", () => {
    const out = mergeInventory(book, [pos({ symbol: "BTC", quantity: 0.25 })], () => "add");
    expect(out).toHaveLength(2);
    expect(out[1]?.quantity).toBeCloseTo(0.75);
  });

  test("resolves each conflict independently by key", () => {
    const out = mergeInventory(
      book,
      [pos({ isin: "US0378331005", symbol: "AAPL", quantity: 5 }), pos({ symbol: "BTC", quantity: 1 })],
      (k) => (k === "BTC" ? "add" : "replace"),
    );
    expect(out[0]?.quantity).toBe(5); // AAPL replaced
    expect(out[1]?.quantity).toBeCloseTo(1.5); // BTC summed
  });

  test("an empty book (first-run onboarding) is just the additions", () => {
    const additions = [pos({ symbol: "AAPL", quantity: 1 }), pos({ symbol: "MSFT", quantity: 2 })];
    expect(mergeInventory([], additions, () => "replace")).toEqual(additions);
  });
});

describe("simSeedsFromInventory — anchor the price layer to the real market", () => {
  test("seeds an onboarded instrument from its captured reference price", () => {
    const [seed] = simSeedsFromInventory([
      demo({ isin: "DE0007164600", symbol: "SAP", quantity: 10, referencePrice: 240.5, currency: "EUR" }),
    ]);
    // Without the reference price this fell back to 100 — the bug that made every
    // non-demo holding's value grossly wrong.
    expect(seed?.previousClose).toBe(240.5);
  });

  test("a captured price wins over the demo catalogue seed", () => {
    const [seed] = simSeedsFromInventory([demo({ symbol: "AAPL", quantity: 1, referencePrice: 250 })]);
    expect(seed?.previousClose).toBe(250);
  });

  test("falls back to the neutral baseline only when nothing better exists", () => {
    const [seed] = simSeedsFromInventory([demo({ symbol: "ZZZ", quantity: 1 })]);
    expect(seed?.previousClose).toBe(100);
  });
});
