---
title: "ISIN Is Canonical; LLM Proposes, Resolver Disposes"
description: "A Gemini-emitted ISIN is a hypothesis validated by checksum then cross-resolved against the L&S instrument-search endpoint before it is trusted; nothing streams without a verified ISIN."
type: adr
category: data
tags: [isin, identity-resolution, gemini, instrument-search]
status: accepted
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [gemini, vertex-ai, lightstreamer, firestore, typescript]
---

# ADR-0007: ISIN Is Canonical; LLM Proposes, Resolver Disposes

## Status

Accepted

## Context

### Background and Problem Statement

cancri's portfolio onboarding pipeline (brief §2.B) ingests messy free text — chat, CSV, Excel, pasted blobs — and must convert each position into a structured inventory row whose identity the live data layer can actually subscribe to. The brief is explicit that **ISIN is the central key**: the L&S tap maps ISIN to L&S's own internal instrument id via the source's instrument-search endpoint (Appendix A), the Yahoo fallback maps ISIN to an exchange-suffixed symbol (Appendix B), and the RTDB tick bus addresses quotes at `/quotes/{isin}`. ISIN is therefore the single join key threaded end to end through every subsystem (cross-cutting decision 6), the address under which the feed-engine overwrites ticks (ADR-0004), and the partition of the public price namespace (ADR-0005). A wrong or fabricated ISIN does not produce a visible error — it silently subscribes to the wrong instrument, or to nothing, and the user watches a confidently-rendered price for a security they do not own.

The hard part is the producer. The identity is proposed by Gemini, a generative model that will, when asked for an ISIN it does not know, emit a syntactically plausible 12-character string that is **fabricated**. ISINs have a Luhn-mod-10 check digit, so many fabrications are catchable cheaply, but a checksum-valid string can still name the wrong instrument, or a real instrument L&S does not carry. We need a trust boundary between "what the model said" and "what we will subscribe to," and that boundary must live server-side because the L&S instrument-search endpoint is the same private resolver the tap depends on (cross-cutting decision 1, brief §2.C, §3) — exposing it to the client would leak source internals and dissolve the server trust boundary the brief mandates.

This decision is **hard to reverse** because the verified-ISIN invariant is load-bearing for everything downstream. The Tick contract (ADR-0006) keys on `identity`; the inventory schema in `packages/data-contracts` carries the resolved ISIN; Firestore rules, RTDB node paths, and the day-change `previousClose` Yahoo read (cross-cutting decision 6) all assume the ISIN in a confirmed row is real and resolvable. Relaxing "nothing streams without a verified ISIN" later would mean re-validating every persisted holding, re-keying the wire, and re-auditing the trust boundary across three runtime classes — not a config flip.

### Current Limitations

1. There is no current system; this ADR sets the foundational identity-resolution contract. The constraints below are the ones any approach must overcome.
2. Gemini fabricates plausible ISINs on demand and cannot be trusted as a source of record for identity; its output is a hypothesis, not a fact.
3. The authoritative ISIN→instrument map for the live layer is private to L&S, reachable only through its instrument-search endpoint, which must be called server-side and is also the resolver the tap itself uses.
4. Free-text input is genuinely ambiguous: a name like "Allianz" maps to multiple lines/venues; without disambiguation the pipeline would either guess wrong or stall.
5. A wrong-but-checksum-valid ISIN fails silently downstream — it mis-subscribes rather than erroring — so validation must happen before persistence, not at render time.

## Decision Drivers

### Primary Decision Drivers

1. **ISIN is the canonical identity (cross-cutting decision 6)**: every subsystem — L&S tap, Yahoo fallback, RTDB `/quotes/{isin}`, Firestore inventory, Tick `identity` — joins on ISIN, so a confirmed inventory row must carry a *verified* ISIN before any subscription is possible.
2. **No fabrication may reach the wire**: the brief's read-only display means a wrong price is the worst failure mode (silent, confident, undetectable to the user). A deterministic gate — Luhn-mod-10 checksum plus instrument-search existence — must reject hypotheses the model cannot back up.
3. **Server-side trust boundary (brief §2.C, §3; cross-cutting decision 1)**: source logic and the instrument-search endpoint run server-side only; identity must be resolved where the secret/endpoint lives, never in the client.
4. **Ambiguity is asked, never auto-picked (brief §2.B, §2.5)**: "the LLM proposes, the user disposes" — multiple candidate matches surface to the confirm screen as choices; the pipeline never silently selects one.
5. **The resolver is shared with the tap**: the L&S instrument-search call that validates an ISIN at onboarding is the same one the feed-engine uses to map ISIN→internal id at subscribe time, so resolution is ground truth, not a second-best heuristic.

### Secondary Decision Drivers

1. **Single shared seam (cross-cutting decision 5)**: the verified ISIN and inventory schema live in `packages/data-contracts`; nothing source-specific (L&S internal ids, Yahoo suffixes) crosses that boundary.
2. **Auditability (brief §3)**: the propose→validate→confirm path is naturally append-only into the Firestore audit trail, recording what the model proposed versus what the user confirmed.
3. **Functions, not sockets, for resolution (cross-cutting decision 1)**: instrument search is a request-scoped lookup, so it fits a request-scoped Cloud Function (the ISIN instrument-search proxy in the runtime topology) rather than the always-on feed-engine.
4. **Cost and latency of model calls**: a checksum reject is free and instant; doing it before the network round-trip to instrument search trims both Vertex AI re-prompts and L&S lookups.

## Considered Options

### Option 1: Two-stage — LLM extraction, then deterministic checksum + instrument-search resolve + re-score

**Description**: Gemini performs extraction/normalisation only — it proposes a candidate identity (free-text name plus a proposed ISIN and/or symbol) with a confidence signal. That proposal is then run through a deterministic server-side pipeline: (a) Luhn-mod-10 checksum validation of any proposed ISIN, (b) a call to the L&S instrument-search endpoint (via the request-scoped instrument-search Function) to confirm the ISIN names a real, carried instrument and to fetch the internal id, and (c) a re-score that resolves to exactly one verified ISIN, surfaces multiple matches as candidates back to the confirm screen, or marks the row unresolved. Only a verified ISIN is written to the Firestore inventory and is ever eligible to stream.

**Technical Characteristics**:
- Clear split of duties: the model extracts (probabilistic), the resolver disposes (deterministic). The trust boundary is the checksum + instrument-search gate.
- Instrument search runs in the request-scoped ISIN proxy Function, server-side, under service-account IAM — the same endpoint the feed-engine tap uses to map ISIN→internal id.
- Checksum (Luhn-mod-10) is a free pre-filter that rejects fabrications before any network call.
- Ambiguity is first-class: N>1 matches become candidates on the confirm screen (brief §2.B); the pipeline never auto-picks.
- The verified ISIN and inventory schema are defined in `packages/data-contracts`; L&S internal ids never cross that seam.
- Invariant enforced at persistence time: "nothing streams without a verified ISIN."

**Advantages**:
- Fabrications are caught by checksum at zero cost; wrong-but-valid strings are caught by instrument-search existence — the two failure classes are covered by two cheap deterministic gates.
- Ground-truth resolution reuses the tap's own resolver, so an ISIN that validates at onboarding is exactly an ISIN the live layer can subscribe to — no impedance mismatch.
- Honest about ambiguity: surfaces candidates rather than guessing, satisfying propose/approve and the brief's "do not guess — ask the user."
- Keeps the model in the role it is good at (messy text → structured fields) and out of the role it is bad at (being a system of record for identity).
- Server-side throughout; no source internals or endpoint reach the client.

**Disadvantages**:
- Two stages and a network round-trip to instrument search add latency and a moving part to the onboarding path versus trusting the model directly.
- Depends on the L&S instrument-search endpoint being reachable at onboarding time; an outage there degrades resolution (though it degrades the tap equally, so it is a shared dependency, not a new one).
- Re-score logic (one match vs many vs none, ISIN vs symbol proposals) is real code that must be specified and tested.

**Risk Assessment**:
- **Technical Risk**: Medium. The checksum and re-score are simple; the coupling risk is the dependency on a private, undocumented L&S endpoint, mitigated by sharing it with the tap (one resolver, one place to fix).
- **Schedule Risk**: Low. Luhn-mod-10 and an existence lookup are well-understood; the model already produces structured output for the normalisation step.
- **Ecosystem Risk**: Medium. The instrument-search endpoint is undocumented and part of the L&S break surface (Appendix A); a change there is covered by the self-heal mechanism (ADR-0010) but is a standing exposure.

### Option 2: Trust the LLM-proposed ISIN directly

**Description**: Take Gemini's proposed ISIN at face value, write it straight to inventory, and subscribe on it. No checksum, no instrument-search confirmation — the model's confidence signal is the only gate.

**Technical Characteristics**:
- Single stage; the normalisation call is the whole pipeline.
- No server-side resolver dependency for onboarding (the tap still needs instrument search at subscribe time, so the endpoint is not actually avoided).
- Identity correctness rides entirely on model output.

**Advantages**:
- Simplest possible path: fewest moving parts, lowest onboarding latency, no re-score code.
- No onboarding-time dependency on the L&S endpoint.

**Disadvantages**:
- The model fabricates plausible ISINs; a fabricated, checksum-invalid, or wrong-instrument ISIN flows silently to the wire and renders a confident wrong price — the worst failure mode for a read-only terminal.
- Violates the brief's "ISIN is the central key… do not guess — ask the user": there is no disposer, only a proposer.
- Wrong identity surfaces only when a subscription returns nothing or the sanity oracle flags a price mismatch — far downstream of where it was introduced, and hard to attribute.

**Risk Assessment**:
- **Technical Risk**: High. Unvalidated identity is a silent-corruption source that poisons every downstream join keyed on ISIN.
- **Schedule Risk**: Low. Trivial to build — the risk is operational, not schedule.
- **Ecosystem Risk**: Medium. Decouples onboarding from the L&S endpoint but defers all identity failures into the live layer, where they are costlier to diagnose.

**Disqualifying Factor**: Fails the non-negotiable invariant "nothing streams without a verified ISIN" and the brief's no-silent-adoption governance.

### Option 3: Pure deterministic parsing without an LLM

**Description**: Drop Gemini from identity resolution. Parse input with regexes/heuristics: detect ISIN-shaped tokens, look up names against a static instrument table, and require structured columns for CSV/Excel.

**Technical Characteristics**:
- Fully deterministic; no model call in the identity path.
- Relies on a maintained name→ISIN table and rigid input assumptions.
- Checksum validation still applies to any extracted ISIN.

**Advantages**:
- Deterministic and cheap; no model fabrication risk at all.
- No Vertex AI dependency for resolution; reproducible offline.

**Disadvantages**:
- Fails the brief's core input requirement: chat and pasted *raw text* are messy and unstructured — heuristics cannot reliably extract "300 shares of the German insurer, the blue one" into an identity. The brief explicitly converges all four channels (chat, CSV, Excel, raw text) on the same normalisation step, which presupposes an LLM.
- A static name table is a maintenance burden and is stale by construction; it cannot keep pace with the instrument universe the tap can resolve.
- Brittle: small format variations break parsing, pushing users toward errors rather than asking-back.

**Risk Assessment**:
- **Technical Risk**: Medium. The parser itself is reliable, but its coverage of real-world messy input is poor, producing high silent-miss rates.
- **Schedule Risk**: Medium. Building and maintaining robust heuristics and a name table rivals the cost of the model path without its flexibility.
- **Ecosystem Risk**: Low. No model dependency, but the static table diverges from the live instrument universe over time.

**Disqualifying Factor**: Cannot satisfy the brief's free-text/chat input channels; defeats the purpose of a Gemini-driven onboarding.

### Option 4: Resolve identity client-side

**Description**: Ship the instrument-search resolution to the browser — the client calls the L&S search endpoint (or a thin pass-through) directly, validates, and writes the resolved ISIN to inventory.

**Technical Characteristics**:
- Resolution logic and endpoint access live in `apps/web`.
- No server round-trip for the resolve step (beyond the endpoint call itself).
- Trust boundary collapses to the client.

**Advantages**:
- Removes one server hop from onboarding; resolution feels immediate.
- Reuses the same instrument-search endpoint as the tap.

**Disadvantages**:
- Leaks the L&S instrument-search endpoint and its calling convention into the client — exactly the source internals the brief forbids exposing (§2.C, §3).
- No server trust boundary: a tampered client could write any ISIN to inventory, defeating validation entirely.
- Couples the client to the undocumented L&S break surface (Appendix A); a protocol change would require client redeploys and is outside the self-heal module's bounded fix target (ADR-0009/0010).
- CORS/origin sensitivities (Appendix A requires a specific origin) make a direct browser call to the L&S endpoint fragile or impossible without a server proxy anyway.

**Risk Assessment**:
- **Technical Risk**: High. Client-side validation is not a trust boundary; identity can be forged past it.
- **Schedule Risk**: Medium. Origin/CORS constraints likely force a server proxy regardless, eroding the only advantage.
- **Ecosystem Risk**: High. Binds the public client to the undocumented, breakage-prone L&S surface, outside the quarantined self-heal module.

**Disqualifying Factor**: Violates the brief's "no source internals or secrets in the client" and provides no real trust boundary.

## Decision

Adopt **Option 1: two-stage resolution — Gemini extracts a hypothesis, a deterministic server-side resolver disposes.** A Gemini-emitted ISIN is treated as a proposal, never a fact. It is validated by Luhn-mod-10 checksum, then cross-resolved against the L&S instrument-search endpoint to confirm it names a real, carried instrument and to obtain the internal id, then re-scored to a single verified ISIN, a set of surfaced candidates, or an unresolved row. **Nothing streams without a verified ISIN.**

The implementation will use:
- **Gemini (Callable Function, Vertex AI via service-account IAM — ADR-0008)** for extraction/normalisation only: messy input → structured proposal with a confidence/uncertainty signal. The model proposes identity; it does not record it.
- **A Luhn-mod-10 checksum gate** as a free, instant pre-filter that rejects fabricated/malformed ISINs before any network call.
- **The request-scoped ISIN instrument-search proxy Function (ADR-0002)** as the deterministic resolver, calling the L&S instrument-search endpoint server-side — the *same* resolver the feed-engine tap uses for ISIN→internal-id mapping, so onboarding validation and live subscription share one ground truth.
- **A re-score step** that maps the resolver result to exactly one of: one verified ISIN (resolved), N>1 matches (surfaced as candidates to the confirm screen — never auto-picked), or zero matches (unresolved, asked back).
- **`packages/data-contracts` (ADR-0005/0006)** to define the verified-ISIN inventory schema and Tick `identity`; L&S internal ids and Yahoo suffixes stay inside their adapters and never cross the seam.
- **Firestore (ADR-0004)** to persist only confirmed rows carrying a verified ISIN, with the propose-vs-confirm delta written append-only to the audit trail.

## Consequences

### Positive

1. **Fabrication cannot reach the wire**: the checksum catches malformed/invented ISINs for free; instrument-search existence catches checksum-valid-but-wrong ones. The two failure classes are gated before persistence, upholding the canonical-identity invariant.
2. **Onboarding and live layer agree by construction**: because validation reuses the tap's resolver, every ISIN that passes onboarding is one the feed-engine can subscribe to — no class of "valid at onboarding, dead at subscribe."
3. **Honest disambiguation**: ambiguous names surface as candidate choices on the confirm screen, satisfying "the LLM proposes, the user disposes" and the brief's no-guessing rule.
4. **Clean trust boundary**: identity is decided server-side where the endpoint and IAM live; the client only ever receives normalised, verified data.
5. **Auditability for free**: the proposal→verified→confirmed path writes naturally into the append-only Firestore audit trail.

### Negative

1. **Onboarding latency and a shared external dependency**: every resolution incurs a server round-trip to the undocumented L&S instrument-search endpoint; if that endpoint is down or changes shape, onboarding resolution degrades. This is a real, hard-to-remove coupling — it is the price of using ground truth instead of a heuristic.
2. **Re-score is genuine, testable logic**: the one-vs-many-vs-none branching, ISIN-vs-symbol proposals, and candidate-surfacing are non-trivial code that must be specified and covered, not a one-liner.
3. **The verified-ISIN invariant is hard to reverse**: once inventory, RTDB node paths, the Tick contract, and the day-change Yahoo read all assume a real ISIN per row, relaxing the gate later means re-validating every persisted holding and re-auditing the trust boundary across three runtime classes — a migration, not a flag.
4. **Resolver coupled to the L&S break surface**: the instrument-search endpoint is part of the undocumented protocol (Appendix A) that can change underneath us, so identity resolution inherits the same fragility as the tap.

### Neutral

1. **Gemini is demoted to extractor**: the model still does real work (messy text → structured fields) but is deliberately removed from the system-of-record role — a scoping choice, neither inherently good nor bad.
2. **Symbol is secondary**: ISIN is canonical; per-source symbol/venue (Yahoo `.DE`/`.HM` suffixes, L&S internal id) is derived inside each adapter and never the join key.
3. **Checksum is a filter, not proof**: Luhn-mod-10 only proves well-formedness; existence is proven solely by instrument search — the two gates are complementary and neither alone suffices.

## Decision Outcome

The objectives are met: the canonical-identity invariant (driver 1) holds because only checksum-valid, instrument-search-confirmed ISINs are persisted and only verified ISINs may stream (driver 2); the trust boundary stays server-side in the request-scoped proxy Function (driver 3); ambiguity surfaces as user-facing candidates rather than silent guesses (driver 4); and resolution reuses the tap's own resolver so onboarding and the live layer cannot disagree (driver 5). The shared `data-contracts` seam keeps source-specific ids out of the contract (secondary driver 1) and the propose/confirm delta feeds the audit trail (secondary driver 2).

Mitigations:
- For the external-dependency negative (1): the instrument-search endpoint is the *same* one the feed-engine depends on, so it is one surface to monitor and one place to repair — the self-heal mechanism (ADR-0010) and the ls-protocol module (ADR-0009) already own its breakage path; onboarding does not introduce a new dependency, it shares an existing one.
- For the re-score complexity (2): specify the one/many/none branches as pure functions in `data-contracts`-typed inputs and cover them with deterministic unit tests; candidate-surfacing is data-driven, not bespoke per case.
- For the hard-to-reverse invariant (3): make the verified-ISIN requirement explicit in the inventory schema (a row without a verified ISIN is not adoptable), so the invariant is enforced at the type/rules level and cannot silently erode.
- For break-surface coupling (4): keep the instrument-search call inside the bounded, quarantined resolver path so a protocol change is a localised fix gated by the offline replay regression (ADR-0009/0010), not a scattered edit.

## Related Decisions

- [ADR-0002: Runtime Classes](0002-three-runtime-classes-execution-model.md) — the ISIN instrument-search resolver is the request-scoped proxy Function defined there.
- [ADR-0003: Feed-Engine](0003-feed-engine-single-process-singleton.md) — the tap uses the same instrument-search resolver to map ISIN→internal id at subscribe time.
- [ADR-0004: Datastore Split](0004-datastore-split-firestore-book-rtdb-wire.md) — verified ISINs persist in the Firestore book; ticks address `/quotes/{isin}` on RTDB.
- [ADR-0005: Transport](0005-realtime-transport-rtdb-tick-bus.md) — RTDB node paths are keyed by the verified ISIN.
- [ADR-0006: Tick Contract](0006-tick-schema-and-source-adapter-contract.md) — Tick `identity` is the verified ISIN; the inventory schema lives in the same shared package.
- [ADR-0008: Gemini Normalisation](0008-gemini-vertex-iam-callable.md) — supplies the proposal stage; this ADR constrains the model to proposer, not disposer.
- [ADR-0009: ls-protocol Module](0009-ls-protocol-break-surface-isolation.md) — owns the instrument-search/id-mapping break surface this resolver depends on.
- [ADR-0010: Self-Heal](0010-self-heal-governance-pr-deterministic-gate.md) — repairs the instrument-search endpoint if its protocol changes.

## Links

- [cancri Implementation Brief](../../design/IMPLEMENTATION_BRIEF.md) — §2.B portfolio onboarding and identity resolution, §2.C live data layer and ISIN→instrument-id mapping, §2.5 acceptance criteria, §3 governance (no secrets in client, propose/approve).
- [Implementation Brief — Appendix A (L&S)](../../design/IMPLEMENTATION_BRIEF.md) — ISIN→internal instrument id resolved via the source's instrument-search endpoint; the bounded break surface.
- [Implementation Brief — Appendix B (Yahoo)](../../design/IMPLEMENTATION_BRIEF.md) — German exchange-suffix symbol mapping derived from ISIN inside the Yahoo adapter.

## More Information

- **Date:** 2026-06-27
- **Source:** cancri decomposition pass; Implementation Brief §2.B/§2.C, Appendix A/B; cross-cutting decisions 1, 5, 6.
- **Related ADRs:** 0002, 0003, 0004, 0005, 0006, 0008, 0009, 0010.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created, awaiting implementation.

**Action Required:** Implement decision and audit.
