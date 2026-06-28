---
title: "Domain Logo Provider With Monogram Fallback"
description: "Resolve brand logos server-side from a keyless domain-based logo CDN (Clearbit-style), verify the response is an image before returning it, and fall back to a client-rendered monogram whenever no honest logo is available."
type: adr
category: architecture
tags: [frontend, functions, assets, third-party]
status: proposed
created: 2026-06-28
updated: 2026-06-28
author: "Thomas Sprock"
project: cancri
technologies: [firebase-functions, typescript, duckduckgo, vite]
related: [0001-pin-region-europe-west1.md, 0007-isin-resolution-llm-proposes-resolver-disposes.md, 0011-frontend-vanilla-ts-vite-single-raf.md]
---

# ADR-0014: Domain Logo Provider With Monogram Fallback

## Status

Proposed

## Context

### Background and Problem Statement

The terminal renders roughly a dozen instrument rows, and the brief (§E,
asset_specs) calls for a brand logo on each row, with a generated monogram as the
honest fallback when no logo exists. The choice of *where logos come from* was
explicitly deferred to "Phase 7" in the brief and noted as deferred in an earlier
ADR. To keep that deferral honest, `functions/src/logo.ts` shipped a
`noProviderFetcher` that always returns `null`: the `logo` callable therefore always
resolved to a monogram signal, the client never invoked the callable, and the
dashboard never rendered an `<img>` at all. The net effect is that the entire
"logo download" path is a no-op end to end — a placeholder pretending to be a
feature.

This ADR closes that deferral by choosing a real provider. The product wants actual
brand logos on the rows. The constraint is twofold: the terminal must stay **honest**
— it must never show a wrong logo or a generic placeholder image dressed up as a real
one — and the platform mandate (CLAUDE.md, brief §3) is that **data stays inside the
Firebase project**, with all source access and credentials server-side. A logo source
necessarily reaches outside that boundary, so the question is not "an implementation
detail" but a deliberate, reviewable choice about *which* boundary crossings we accept
and under what verification.

The decision is recorded as an ADR because it introduces an **outbound dependency that
crosses the Firebase project boundary in two distinct places**: the `logo` Function
fetches a candidate URL from a third-party CDN during verification, and the client
browser then loads the resolved image directly from that same CDN when rendering a row.
Both crossings are new egress that the platform constraints make a conscious decision
rather than a code-review footnote, and the choice displaces plausible alternatives
(keyed providers, favicon services, status-quo monogram-only) worth recording.

### Current Limitations

1. `functions/src/logo.ts` wires a `noProviderFetcher` that returns `null`
   unconditionally, so every instrument resolves to a monogram and no logo ever
   appears — the feature is inert.
2. The client never calls the `logo` callable and never constructs an `<img>`, so
   there is no render path for a resolved logo even if one existed.
3. The `LogoResult` type is local to the Function, so there is no shared
   function↔client contract for the two states (resolved URL vs monogram signal).
4. There is no domain source: nothing maps an ISIN/symbol to the web domain a
   domain-based logo provider requires.

## Decision Drivers

### Primary Decision Drivers

1. **Honesty over decoration**: the terminal's core stance is to be honest about its
   data (live vs delayed; verified ISIN before streaming, ADR-0007). A logo is held to
   the same bar — show the real brand mark or an honest monogram, never a wrong image
   or a placeholder masquerading as a logo. This forces *verify-before-resolve*: the
   server only returns a URL it has confirmed is an image.
2. **No new secret**: source access and credentials are server-side by mandate, and
   every secret is something to provision, rotate, and risk leaking. A keyless provider
   adds a capability with nothing to manage, keeping the operational and security
   surface flat.
3. **Conscious boundary egress**: "data stays inside the Firebase project" means any
   outbound call is a decision, not a default. The chosen path must make both egress
   points (server verification, client CDN load) explicit, bounded, and individually
   removable later.
4. **Ship the first version cheaply**: low latency and no in-project asset storage for
   v1, so the feature lands as a small, reviewable diff over the existing
   resolve/monogram seam rather than a new storage and caching subsystem.

### Secondary Decision Drivers

1. **Testability of the resolver**: `resolveLogo` already injects its fetcher, so a
   real provider can be exercised with deterministic fakes without network calls in CI.
2. **Coverage that degrades gracefully**: instruments with no known domain (most
   crypto, many funds) must remain monogram by design, not error — the absence of a
   logo is a normal, honest state, not a failure.
3. **Single shared contract seam (ADR-0006/0011)**: the two-state `LogoResult` belongs
   in `@cancri/data-contracts` as the function↔client contract, consistent with the
   project's one-seam discipline.
4. **Region consistency (ADR-0001)**: the callable stays in `europe-west1` alongside
   the rest of the Functions surface.

## Considered Options

### Option 1: Keyless domain-based logo CDN (Clearbit-style), server-verified

**Description**: Resolve logos from a keyless, domain-addressed logo service in the
Clearbit style — `https://logo.clearbit.com/{domain}`. Resolution stays server-side in
the existing `logo` `onCall` (`europe-west1`): the Function derives a candidate domain,
fetches the candidate URL, and returns `{ state: "resolved", url }` **only** when the
response is OK and its `content-type` is an image; otherwise it returns the existing
monogram signal `{ state: "monogram", initials, accent }`. The server never returns a
fallback image — the monogram is generated client-side from the signal (unchanged from
brief §E). Domains come from a curated `symbol→domain` map in `@cancri/data-contracts`
(`domainForSymbol`) plus any `domain` Gemini may attach to a proposed position;
instruments with no known domain stay monogram by design. The client gains a
`callLogo(symbol, domain)` path and renders an `<img>` for resolved URLs, **preloading
the image before swapping the monogram tile** so there is never a broken-image flash.
The browser loads the image directly from the provider CDN; no Cloud Storage caching
yet.

**Technical Characteristics**:
- Keyless: no API key, no secret to provision or rotate; domain is the only input.
- Two states only, defined once in `@cancri/data-contracts` as `LogoResult`:
  `resolved` (a verified image URL) or `monogram` (initials + accent signal).
- Verify-before-resolve: the Function checks HTTP OK + image `content-type` before it
  will ever return a URL; a non-image or error collapses to the monogram signal.
- Domain provenance is explicit: curated `domainForSymbol` map, optionally enriched by
  a Gemini-supplied `domain` on a proposed position; no domain ⇒ monogram.
- Two boundary crossings, both intentional: Function→CDN at verify time,
  browser→CDN at render time.
- Client preloads the resolved image off-screen and only swaps the monogram tile on
  successful decode, so a late provider failure degrades silently to the monogram.

**Advantages**:
- Real brand logos with a genuinely honest fallback: nothing wrong or placeholder ever
  renders, satisfying the project's honesty stance directly.
- No new secret — flat operational and security surface; nothing to leak or rotate.
- Small, reviewable diff over the existing seam: `resolveLogo` already injects its
  fetcher, so the change is swapping `noProviderFetcher` for a real one plus a thin
  client render path.
- Low latency and zero asset-storage cost for v1; the browser pulls straight from a CDN
  built for image delivery.
- Both egress points are explicit and individually removable: a later in-project cache
  can eliminate the client→CDN crossing without touching the contract.

**Disadvantages**:
- Outbound calls leave the Firebase project boundary in two places (Function
  verification fetch and client CDN image load), which is exactly the egress the
  platform constraint asks us to minimise.
- Hard dependency on a third-party CDN's availability and coverage; an outage or a
  withdrawn logo turns a row monogram with no in-project copy to fall back to.
- Logos are not cached in-project yet, so the client→CDN crossing is on the live render
  path until a follow-up adds storage.
- Coverage is only as good as the curated `domainForSymbol` map until Gemini reliably
  supplies domains.

**Risk Assessment**:
- **Technical Risk**: Low. The resolver is a single fetch plus a content-type check
  behind an injectable seam; the monogram fallback means any failure mode is already a
  supported state, and the client preload removes the broken-image flash.
- **Schedule Risk**: Low. The seam, the monogram signal, and the injectable fetcher
  already exist; the work is a real fetcher, a shared type move, a curated map, and a
  client `<img>` path.
- **Ecosystem Risk**: Medium. A keyless public endpoint carries no contractual SLA;
  availability, coverage, or terms can change, and there is no in-project copy yet —
  mitigated by the always-available monogram and the planned cache follow-up.

### Option 2: Keyed provider (Brandfetch / Logo.dev)

**Description**: Use a richer commercial logo API (Brandfetch, Logo.dev) that offers
higher-quality, better-curated marks and broader coverage, authenticated with an API
key held server-side and called from the `logo` Function.

**Technical Characteristics**:
- Higher logo quality and coverage than a keyless CDN; richer metadata (formats, theme
  variants) available.
- Requires a new server-side secret (API key) in Secret Manager / Functions config.
- Subject to rate limits and commercial/attribution terms that bind usage.

**Advantages**:
- Best-in-class logo quality and the widest coverage of the options.
- Structured metadata (resolution, light/dark variants) could feed a richer render.
- Verify-before-resolve still applies; the honesty model is unchanged.

**Disadvantages**:
- Introduces a new secret to provision, rotate, and protect — directly against the
  "no new secret" driver and adding to the leak/rotation surface the project keeps flat.
- Rate limits and commercial terms add operational constraints and a usage-tracking
  obligation that v1 does not need.
- Larger first-version diff: secret wiring, error/limit handling, and terms compliance
  for a feature whose honest fallback already covers the gap.

**Risk Assessment**:
- **Technical Risk**: Low. The integration is well-trodden, but secret handling and
  rate-limit logic add moving parts that can fail in production.
- **Schedule Risk**: Medium. Secret provisioning, rotation policy, and terms review are
  real setup cost beyond the resolver itself.
- **Ecosystem Risk**: Medium. Commercial terms and pricing can change and bind usage;
  a key is a standing liability even when the provider is healthy.

**Disqualifying Factor (for v1)**: A new server-side secret violates the "no new secret"
primary driver; the quality gain does not justify the added operational and security
surface while a keyless option meets the honesty bar.

### Option 3: Google favicon service (s2/favicons)

**Description**: Resolve marks from Google's keyless favicon endpoint
(`s2/favicons?domain=...`), reusing the same domain map and server verification.

**Technical Characteristics**:
- Keyless, like Option 1; same domain-derivation and verify-before-resolve path.
- Returns site **favicons**, not brand logos, typically at low resolution (16–64px).

**Advantages**:
- Keyless: no secret, same flat operational surface as Option 1.
- Very broad coverage of any site with a favicon.

**Disadvantages**:
- Returns favicons, not brand logos — wrong artefact for a row mark, and often a
  cropped or generic icon rather than the brand.
- Low resolution looks poor on the terminal's row tiles and cannot scale crisply.
- Quality is inconsistent enough that "honest logo" is not reliably met; many results
  would be better served by the monogram.

**Risk Assessment**:
- **Technical Risk**: Low. Mechanically identical to Option 1.
- **Schedule Risk**: Low. Same seam and verification.
- **Ecosystem Risk**: Medium. Keyless and unguaranteed, and the artefact itself is the
  wrong one.

**Disqualifying Factor**: Favicons fail the quality bar — a low-resolution site icon is
not the brand logo the brief asks for, so this delivers a worse result than the honest
monogram in many cases.

### Option 4: Status quo — monogram-only (do nothing)

**Description**: Keep `noProviderFetcher`; every instrument renders a generated
monogram and no `<img>` is ever shown.

**Technical Characteristics**:
- Zero outbound dependency; nothing crosses the Firebase project boundary.
- Fully deterministic, entirely in-project, already implemented.

**Advantages**:
- Maximally honest and self-contained: no third-party dependency, no egress, no secret.
- No availability or coverage risk; the monogram always renders.

**Disadvantages**:
- Does not meet the product ask: the brief (§E) calls for real brand logos, and a
  monogram-only terminal leaves that requirement unmet.
- Leaves a shipped-but-inert code path (the callable, the `LogoResult` states) with no
  consumer, which is its own dishonesty about the feature's status.

**Risk Assessment**:
- **Technical Risk**: Low. Nothing changes.
- **Schedule Risk**: Low. No work.
- **Ecosystem Risk**: Low. No external dependency.

**Disqualifying Factor**: Fails the product requirement for real logos; declines the
decision rather than making it.

## Decision

Adopt **Option 1: a keyless, domain-addressed mark service, resolved and verified
server-side, with a client-rendered monogram fallback.** A URL is returned only after
the server has confirmed the response is an image; otherwise the row shows an honest
monogram. No new secret is introduced, and both boundary crossings are explicit and
individually removable.

The concrete provider is **DuckDuckGo's keyless icon service**
(`https://icons.duckduckgo.com/ip3/{domain}.ico`). The originally chosen endpoint,
Clearbit's keyless logo CDN, was sunset in late 2024 and now returns errors, leaving
no keyless *brand-logo* CDN available. This means accepting the favicon-quality
trade-off that disqualified Option 3 (Google favicons): with keyed providers ruled out
for v1 by the "no new secret" driver, a keyless icon service is the only option that
meets the primary drivers, and at the terminal's small row-tile size a domain icon
reads acceptably — while the honest monogram remains the always-available fallback for
any miss. DuckDuckGo's `ip3` endpoint returns the site's higher-resolution icon
(apple-touch-icon where present), which is closer to a brand mark than the low-res
`s2/favicons` artefact Option 3 weighed.

The implementation will use:
- **`https://icons.duckduckgo.com/ip3/{domain}.ico`** as the keyless mark source, with no API key.
- **The existing `logo` `onCall` Function (`europe-west1`, ADR-0001)** as the
  server-side resolver: it derives a candidate domain, fetches the URL, and returns
  `{ state: "resolved", url }` only on HTTP OK with an image `content-type`; otherwise
  `{ state: "monogram", initials, accent }`. The server never returns a fallback image.
- **`@cancri/data-contracts`** to hold the shared `LogoResult` type (the
  function↔client contract) and the curated `domainForSymbol` map; a Gemini-supplied
  `domain` on a proposed position enriches the map at resolution time.
- **A client `callLogo(symbol, domain)` path** that invokes the callable, **preloads**
  the resolved image off-screen, and swaps the monogram tile for an `<img>` only after a
  successful decode, so a provider failure degrades silently to the monogram with no
  broken-image flash. Instruments with no known domain stay monogram by design.
- **No Cloud Storage caching in v1**, recorded explicitly as a future optimisation
  (its own follow-up) that would pull assets in-project and remove the client→CDN egress.

## Consequences

### Positive

1. **Real logos, honest fallback**: rows show actual brand marks where a domain
   resolves and verifies, and an honest monogram everywhere else — nothing wrong or
   placeholder ever renders, upholding the project's honesty stance.
2. **No new secret**: the keyless source keeps the operational and security surface
   flat; there is nothing to provision, rotate, or leak.
3. **Small, testable diff**: `resolveLogo` already injects its fetcher, so the change is
   a real fetcher plus a thin client render path; the resolver is exercised with
   deterministic fakes in CI without network calls.
4. **Removable egress**: both boundary crossings are explicit, and a later in-project
   cache can eliminate the client→CDN load without changing the `LogoResult` contract.

### Negative

1. **Two boundary crossings**: outbound calls leave the Firebase project in two places
   — the Function's verification fetch and the browser's CDN image load — which is
   exactly the egress the platform constraint asks us to minimise; the client crossing
   sits on the live render path until a cache follows.
2. **Third-party CDN dependency**: availability, coverage, and terms of a keyless public
   endpoint carry no SLA; an outage or withdrawn logo drops a row to a monogram with no
   in-project copy to fall back on yet.
3. **Coverage is map-bound**: results are only as good as the curated `domainForSymbol`
   map until Gemini reliably attaches domains; many instruments will sit at monogram
   longer than ideal.

### Neutral

1. **Crypto and domainless instruments stay monogram by design**: the absence of a logo
   is a normal, honest state, not a degradation.
2. **Logo quality is provider-bound**: the keyless CDN's mark quality is what it is;
   richer providers exist but are declined for v1 on the secret driver.
3. **Caching is deferred, not foreclosed**: in-project asset storage is a recorded
   future optimisation, with the contract already shaped to accommodate it.

## Decision Outcome

The objectives are met: the honesty driver holds because the server resolves a URL only
after verifying it is an image, and the client preloads before swapping, so a wrong or
broken logo can never render — the monogram is the always-available honest fallback
(drivers 1, secondary 2). No new secret is introduced (driver 2). Both egress points are
explicit and individually removable, making the boundary crossing a conscious, bounded
decision rather than a default (driver 3). The first version ships as a small,
injectable-seam diff with no asset storage (driver 4), and the shared `LogoResult` lives
in the single contracts seam (secondary 3) with the callable pinned to `europe-west1`
(secondary 4).

Mitigations:
- For the boundary-crossing and CDN-dependency negatives (1, 2): the monogram fallback
  is always available, so any provider failure degrades silently; the planned Cloud
  Storage cache (its own follow-up) will pull assets in-project and remove the
  client→CDN crossing, leaving only the server-side verification fetch.
- For verify-before-resolve: the Function checks HTTP OK and image `content-type` before
  returning a URL, so a non-image, error, or hijacked response collapses to the monogram
  rather than rendering.
- For the broken-image flash: the client preloads the resolved image off-screen and
  swaps the tile only on successful decode.
- For map-bound coverage (3): seed the curated `domainForSymbol` map for known
  instruments and let Gemini-supplied domains enrich it over time; domainless rows
  remain honestly monogram.

## Related Decisions

- [ADR-0001: Pin Region europe-west1](0001-pin-region-europe-west1.md) - the `logo`
  callable runs in `europe-west1` alongside the rest of the Functions surface.
- [ADR-0006: Tick Contract](0006-tick-schema-and-source-adapter-contract.md) - the
  shared-contract discipline this ADR follows by moving `LogoResult` into
  `@cancri/data-contracts`.
- [ADR-0007: ISIN Canonical Identity](0007-isin-resolution-llm-proposes-resolver-disposes.md)
  - the same propose/dispose and honesty model: Gemini may supply a `domain`, the
  server disposes by verifying before resolving.
- [ADR-0011: Frontend Vanilla TS, Single rAF](0011-frontend-vanilla-ts-vite-single-raf.md)
  - the client render path that gains the `<img>` swap and preload sits in the cold/UI
  tier of this frontend.

## Links

- cancri implementation brief — `design/IMPLEMENTATION_BRIEF.md`, §E (asset_specs /
  logo resolution and the monogram fallback), and §3 (no secrets in client; data stays
  in the Firebase project).
- [DuckDuckGo icon service](https://icons.duckduckgo.com/ip3/duckduckgo.com.ico) - the
  keyless, domain-addressed mark source chosen for v1 (Clearbit's keyless logo CDN, the
  original choice, was sunset in late 2024).
- `functions/src/logo.ts` - the `logo` callable and the `duckduckgoFetcher` that
  resolves a mark only after verifying it is an image.

## More Information

- **Date:** 2026-06-28
- **Source:** cancri Phase-7 logo-provider decision; Implementation Brief §E/§3;
  CLAUDE.md platform constraints.
- **Related ADRs:** 0001, 0006, 0007, 0011.

## Audit

### 2026-06-28

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created, awaiting implementation.

**Action Required:** Implement decision and audit.
