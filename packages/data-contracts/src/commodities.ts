/**
 * Commodity catalogue — instruments whose quantity is a physical amount the user
 * can hold in more than one unit (precious metals: troy ounces, grams, kilograms).
 *
 * A commodity's market price is quoted per a single *canonical* unit (a troy ounce
 * for metals). A position stores its quantity in whatever `unit` the user picked;
 * valuation converts that quantity into canonical units before multiplying by the
 * price. Switching units preserves the physical holding (10 ozt ⇄ 311.03 g), so it
 * is a pure relabelling of the same amount, never a change in value.
 */

/** One selectable unit and how it relates to the commodity's canonical unit. */
export interface CommodityUnit {
  /** Stored on the Position, e.g. "ozt", "g", "kg". */
  readonly id: string;
  /** Shown in the unit selector, e.g. "oz t", "g", "kg". */
  readonly label: string;
  /** How many canonical units one of THIS unit equals (ozt per gram ≈ 0.0322). */
  readonly perCanonical: number;
}

export interface Commodity {
  readonly symbol: string;
  readonly name: string;
  /** The unit the market price is quoted in (id must appear in `units`). */
  readonly canonicalUnit: string;
  /** Indicative previous close per canonical unit — seeds the simulator. */
  readonly referenceClose: number;
  readonly units: readonly CommodityUnit[];
}

/** Troy-ounce-quoted precious metals. 1 ozt = 31.1034768 g (exact, by definition). */
const GRAMS_PER_TROY_OUNCE = 31.1034768;
const METAL_UNITS: readonly CommodityUnit[] = [
  { id: "ozt", label: "oz t", perCanonical: 1 },
  { id: "g", label: "g", perCanonical: 1 / GRAMS_PER_TROY_OUNCE },
  { id: "kg", label: "kg", perCanonical: 1000 / GRAMS_PER_TROY_OUNCE },
];

const CATALOGUE: readonly Commodity[] = [
  { symbol: "XAU", name: "Gold", canonicalUnit: "ozt", referenceClose: 2330, units: METAL_UNITS },
  { symbol: "XAG", name: "Silver", canonicalUnit: "ozt", referenceClose: 29.4, units: METAL_UNITS },
  { symbol: "XPT", name: "Platinum", canonicalUnit: "ozt", referenceClose: 995, units: METAL_UNITS },
  { symbol: "XPD", name: "Palladium", canonicalUnit: "ozt", referenceClose: 975, units: METAL_UNITS },
];

/** Common free-text symbols that map onto a catalogue entry. */
const ALIASES: Record<string, string> = {
  GOLD: "XAU",
  SILVER: "XAG",
  PLATINUM: "XPT",
  PALLADIUM: "XPD",
};

const BY_SYMBOL = new Map<string, Commodity>(CATALOGUE.map((c) => [c.symbol, c]));

/** The commodity for a symbol (case-insensitive, alias-aware), or undefined. */
export function commodityFor(symbol: string): Commodity | undefined {
  const up = symbol.trim().toUpperCase();
  return BY_SYMBOL.get(up) ?? BY_SYMBOL.get(ALIASES[up] ?? "");
}

/** Look a unit up within a commodity; falls back to its canonical unit. */
export function unitOf(c: Commodity, unitId: string | undefined): CommodityUnit {
  const u = unitId !== undefined ? c.units.find((x) => x.id === unitId) : undefined;
  return u ?? c.units.find((x) => x.id === c.canonicalUnit) ?? c.units[0]!;
}

/** Quantity expressed in canonical (priced) units — the multiplier for valuation. */
export function canonicalQuantity(c: Commodity, quantity: number, unitId: string | undefined): number {
  return quantity * unitOf(c, unitId).perCanonical;
}

/** Re-express a quantity from one unit into another, preserving the physical amount. */
export function convertQuantity(
  c: Commodity,
  quantity: number,
  fromUnitId: string | undefined,
  toUnitId: string,
): number {
  const canonical = canonicalQuantity(c, quantity, fromUnitId);
  return canonical / unitOf(c, toUnitId).perCanonical;
}
