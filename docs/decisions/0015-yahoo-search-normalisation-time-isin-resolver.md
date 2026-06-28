---
title: "Yahoo Instrument-Search as the Normalisation-Time ISIN Resolver"
description: "The first concrete 'resolver disposes' implementation (ADR-0007): a validated ISIN's canonical name/symbol is derived server-side from Yahoo's keyless instrument-search, ahead of the L&S search resolver whose protocol is not yet captured."
type: adr
category: data
tags: [isin, identity-resolution, gemini, instrument-search, yahoo]
status: proposed
created: 2026-06-28
updated: 2026-06-28
author: "Architecture (Claude Code)"
project: cancri
technologies: [yahoo-finance, gemini, vertex-ai, firestore, typescript]
---

# ADR-0015: Yahoo Instrument-Search as the Normalisation-Time ISIN Resolver

## Status

Proposed — refines [ADR-0007](0007-isin-resolution-llm-proposes-resolver-disposes.md) (does not supersede it).

## Context

### Background and Problem Statement

ADR-0007 fixed the identity contract: ISIN is canonical, "the LLM proposes, the resolver disposes," and *nothing streams without a verified ISIN.* It names the **L&S instrument-search endpoint** as the deterministic resolver — the same one the feed-engine tap uses to map ISIN→internal id. But that endpoint sits behind the undocumented L&S protocol whose capture is Phase 6 (ADR-0009); it is not wired yet. In the meantime only the **Luhn-mod-10 checksum** gate (`functions/src/isin.ts`) was live. A checksum proves well-formedness, not identity.

The gap surfaced on a real bank CSV. The row `IE00BK5BQT80 ; VANG.FTSE A.W. DLA` is the Vanguard FTSE All-World UCITS ETF **(USD) Accumulating** tranche. Gemini, asked to resolve name+symbol+ISIN freely, returned the *distributing* tranche — symbol "VWRL", name "…(USD) Distributing" — which is a **different instrument with a different ISIN** (IE00B3RBWM25). The checksum passed (the ISIN was real), so the wrong identity flowed straight to the confirmed book and the live terminal. This is exactly the silent mis-subscription ADR-0007 exists to prevent, and it is live today because the resolver half of "propose/dispose" was unimplemented.

We need a concrete resolver *now*, before the L&S search endpoint exists.

### Current Limitations

1. Only the checksum gate is implemented; the instrument-search resolver named in ADR-0007 is Phase-6 work and unavailable.
2. The L&S search endpoint is behind the undocumented break surface (ADR-0009) — not capturable on the onboarding timeline.
3. Without an ISIN→identity lookup, Gemini's free-text guess is authoritative for name/symbol and can pin the wrong share class of the right ISIN.

## Decision Drivers

1. **Honour ADR-0007's invariant now**: a validated ISIN must drive identity; the model's guess must not be the system of record.
2. **No new private surface**: the resolver should not depend on the un-captured L&S protocol.
3. **Reuse a source the project already commits to**: Yahoo is the planned delayed fallback and the runtime sanity oracle (brief §2.C, Appendix B) — keyless, ISIN-addressable, and it returns the canonical symbol+name.
4. **Honest degradation (ADR-0008 ethos)**: an unreachable/unmatched lookup must flag the row for the user's eye, never present an unverified guess as fact.
5. **Server-side trust boundary**: resolution runs in the Cloud Function, never the client.

## Considered Options

### Option 1 (chosen): Yahoo instrument-search as the resolver, now

Server-side, after Gemini and after the checksum, look the validated ISIN up against Yahoo's keyless search (`/v1/finance/search?q={isin}`); take the canonical name and a real ticker from the best-scored quote; flag the row when the lookup can't confirm it. Symbol selection prefers a real ETF/equity ticker over the bare-ISIN local listing and uses the home market only as a tiebreaker.

- **Advantages**: closes the live bug immediately; no dependency on the un-captured L&S surface; reuses the committed Yahoo source; deterministic, injectable, unit-testable; degrades honestly to a flag.
- **Disadvantages**: Yahoo search is unofficial/undocumented (rate-limits, shape drift); it returns exchange-suffixed symbols that need normalising; it is a *second* resolver alongside the eventual L&S one.

### Option 2: Wait for the L&S instrument-search resolver (ADR-0007 as written)

- **Disqualifying factor**: leaves a known silent mis-identification live until Phase 6; the invariant stays unenforced for the whole interim.

### Option 3: Curate a static ISIN→identity table

- **Disadvantage / disqualifying factor**: stale by construction and cannot keep pace with the instrument universe (the same reason ADR-0007 rejected static parsing). Acceptable only as an offline test stand-in, which is where it lives (`MockIsinResolver`).

## Decision

Implement **Option 1**. Introduce an `IsinResolver` seam (`functions/src/resolve.ts`) with an injected search fetcher:

- **`YahooResolver`** (default in deployment): calls Yahoo search server-side, scores candidate quotes, returns `{symbol, name}` for the canonical instrument, memoised per ISIN; any network/parse failure degrades to `null` (never throws).
- **`MockIsinResolver`** (emulator/tests): a small offline ISIN→identity table so the pipeline runs deterministically without the network — selected by `getIsinResolver()` exactly as `getGeminiClient()` picks the mock.

The normalisation gate (`functions/src/normalize.ts`) is rewired so that, for a checksum-valid ISIN, the resolver disposes: on a hit it overrides Gemini's name/symbol (recording the correction in `uncertaintyNote` when the symbol changes, surfaced on the confirm screen); on a miss it caps confidence below the review threshold so the row is flagged. ISIN remains the canonical key throughout.

This is the **first concrete realisation of ADR-0007's resolver**, not a replacement for it. When the L&S instrument-search endpoint is captured (Phase 6), it becomes the primary resolver — Yahoo then continues as the fallback, consistent with its role in the price layer.

## Consequences

### Positive

1. The live wrong-share-class bug is fixed: a validated ISIN drives identity, so the distributing tranche can no longer masquerade for the accumulating ISIN.
2. ADR-0007's "nothing streams without a verified identity" is enforced for the first time, ahead of the L&S surface.
3. Reuses an already-committed, keyless source; adds no new private dependency and no client exposure.
4. Honest by construction: unconfirmable ISINs are flagged for review, never silently trusted.

### Negative

1. A dependency on an unofficial Yahoo endpoint (rate-limits, undocumented shape) enters the onboarding path; mitigated by per-ISIN memoisation and graceful `null` degradation.
2. A transient Yahoo outage flags otherwise-valid rows for review — an honest-but-conservative failure mode, acceptable because onboarding is already a review step.
3. Two resolvers will coexist until L&S search lands; the seam keeps the switch local.

### Neutral

1. Symbol stays secondary to ISIN (ADR-0007): Yahoo's exchange suffix is stripped to a display ticker; the ISIN is the join key.

## Related Decisions

- [ADR-0007: ISIN Is Canonical; LLM Proposes, Resolver Disposes](0007-isin-resolution-llm-proposes-resolver-disposes.md) — this ADR supplies the concrete resolver it specified, ahead of the L&S endpoint.
- [ADR-0008: Gemini Normalisation](0008-gemini-vertex-iam-callable.md) — the proposer stage whose free-text identity this resolver now disposes of.
- [ADR-0009: ls-protocol Module](0009-ls-protocol-break-surface-isolation.md) — owns the L&S instrument-search surface that will become the primary resolver later.

## Links

- [cancri Implementation Brief](../../design/IMPLEMENTATION_BRIEF.md) — §2.B onboarding/identity resolution; §2.C and Appendix B (Yahoo as fallback and sanity oracle).

## More Information

- **Date:** 2026-06-28
- **Source:** Real bank-CSV onboarding test; IE00BK5BQT80 (accumulating) mis-resolved to the distributing tranche.
- **Related ADRs:** 0007, 0008, 0009.

## Audit

### 2026-06-28

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Resolver seam + Yahoo/mock implementations | functions/src/resolve.ts | - | implemented |
| Resolver wired into the normalisation gate | functions/src/normalize.ts | - | implemented |
| Unit coverage (selection, caching, correction, flag-on-miss) | functions/src/resolve.test.ts, functions/src/normalize.test.ts | - | implemented |

**Summary:** First concrete resolver for ADR-0007, using Yahoo search; awaiting review/merge.

**Action Required:** Review and merge; revisit when the L&S instrument-search resolver lands (Phase 6).
