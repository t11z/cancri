/**
 * The book — a user's confirmed holdings (Firestore in production, ADR-0004).
 *
 * `ProposedPosition` is what Gemini emits and the confirm screen edits; the ISIN
 * is a *hypothesis* until checksum-validated and resolved (ADR-0007), hence
 * optional with a confidence signal. `Position` is the confirmed, ISIN-verified
 * row that actually drives subscriptions and persists.
 */

/** Gemini's proposal for one line — reviewable, correctable, not yet trusted. */
export interface ProposedPosition {
  /** Original free-text name as the user wrote it. */
  readonly name: string;
  /** Resolved ticker/symbol (display + per-source mapping input). */
  readonly symbol: string;
  /** Proposed ISIN — a hypothesis until checksum + resolver verify it. */
  readonly isin?: string;
  readonly quantity: number;
  /** Optional cost basis if the user supplied one. */
  readonly costBasis?: number;
  /** Unit the quantity is expressed in, for commodities (e.g. "g", "ozt"); absent
   *  for plain share/coin counts. See `commodities` for the catalogue. */
  readonly unit?: string;
  /** Primary web domain (e.g. "apple.com") used to resolve a brand logo (ADR-0014). */
  readonly domain?: string;
  /** 0..1 confidence; < 0.7 is flagged for review in the UI. */
  readonly confidence: number;
  /** Where the symbol/venue was resolved, e.g. "NASDAQ". */
  readonly source: string;
  /** Why this row is uncertain, surfaced to the user when present. */
  readonly uncertaintyNote?: string;
}

/** A confirmed, ISIN-verified holding. */
export interface Position {
  /** Canonical ISIN — verified before anything streams (ADR-0007). */
  readonly isin: string;
  readonly symbol: string;
  readonly name: string;
  readonly quantity: number;
  readonly costBasis?: number;
  /** Unit the quantity is expressed in, for commodities (e.g. "g", "ozt"); absent
   *  for plain share/coin counts. The market price is quoted per the commodity's
   *  canonical unit — see `commodities` for conversion. */
  readonly unit?: string;
  /** Primary web domain used to resolve a brand logo (ADR-0014); absent → monogram. */
  readonly domain?: string;
  readonly source: string;
  /** Decorative identity colour from the handover accent_palette (never up/down). */
  readonly accent: string;
}

export interface Inventory {
  readonly positions: readonly Position[];
}
