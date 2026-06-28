import { accentForIdentity, monogramInitials, type LogoResult } from "@cancri/data-contracts";

/**
 * Logo resolution (brief §E, ADR-0014). Server-side: resolve a brand logo for an
 * instrument identity; on any miss, signal the monogram fallback. We NEVER return
 * a fabricated image — the client renders the generated monogram tile from the
 * signal. The fetcher is injected so the decision is unit-testable; the real
 * provider (a keyless domain icon service) is `duckduckgoFetcher` below.
 */

// Handover accent_palette — decorative identity only (never up/down/warn).
const ACCENT_PALETTE = [
  "#7b5cff", "#36f9d0", "#5ec6ff", "#ff5277", "#ffd23f", "#ff8a4c",
  "#4cd4ff", "#b06cff", "#36d39b", "#ff6ba8", "#5b8cff", "#46c8a8",
];

export type { LogoResult };

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
 * Null fetcher — resolves everything to a monogram. Kept for tests and as the
 * honest default when a provider is unavailable.
 */
export const noProviderFetcher: LogoFetcher = async () => null;

/**
 * Real provider (ADR-0014): DuckDuckGo's keyless, domain-addressed icon service.
 * (Clearbit's keyless logo CDN, the original choice, was sunset in late 2024.) We
 * verify the icon actually exists — fetch it and require an image content-type —
 * before resolving, so a 404/placeholder never reaches the client (it gets a
 * monogram instead). No image is stored yet; the client loads the CDN URL directly.
 */
export const duckduckgoFetcher: LogoFetcher = async (domain) => {
  const url = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
  try {
    const res = await fetch(url, { method: "GET" });
    const type = res.headers.get("content-type") ?? "";
    return res.ok && type.startsWith("image/") ? url : null;
  } catch {
    return null;
  }
};
