import { accentForIdentity, monogramInitials } from "@cancri/data-contracts";

/**
 * Logo resolution (brief §E, handover asset_specs). Server-side: resolve a logo
 * for an instrument identity and cache it; on miss, signal the monogram fallback.
 * We NEVER return a fallback image — the client renders the generated monogram
 * tile from the signal. The fetcher is injected so the decision is unit-testable;
 * the real provider fetch + Cloud Storage cache wrap it at runtime.
 */

// Handover accent_palette — decorative identity only (never up/down/warn).
const ACCENT_PALETTE = [
  "#7b5cff", "#36f9d0", "#5ec6ff", "#ff5277", "#ffd23f", "#ff8a4c",
  "#4cd4ff", "#b06cff", "#36d39b", "#ff6ba8", "#5b8cff", "#46c8a8",
];

export type LogoResult =
  | { state: "resolved"; url: string }
  | { state: "monogram"; initials: string; accent: string };

export interface LogoQuery {
  symbol: string;
  domain?: string;
}

export type LogoFetcher = (domain: string) => Promise<string | null>;

export async function resolveLogo(query: LogoQuery, fetcher: LogoFetcher): Promise<LogoResult> {
  if (query.domain !== undefined && query.domain !== "") {
    const url = await fetcher(query.domain);
    if (url !== null) return { state: "resolved", url };
  }
  return {
    state: "monogram",
    initials: monogramInitials(query.symbol),
    accent: accentForIdentity(query.symbol, ACCENT_PALETTE),
  };
}

/**
 * Default fetcher — no logo provider is chosen yet (a Phase-7 decision), so every
 * instrument resolves to a monogram. Swapping in a provider (Clearbit-style domain
 * logo / Brandfetch) + a Cloud Storage cache is a drop-in replacement here.
 */
export const noProviderFetcher: LogoFetcher = async () => null;
