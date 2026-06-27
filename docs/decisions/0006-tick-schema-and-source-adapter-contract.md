---
title: "Shared Tick Schema and SourceAdapter Interface"
description: "A single data-contracts package defines Tick, SourceAdapter, freshness, feed status and inventory; nothing source-specific crosses the seam."
type: adr
category: api
tags: [data-contracts, source-adapter, tick-schema, isin]
status: accepted
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [typescript, pnpm, zod]
---

# ADR-0006: Shared Tick Schema and SourceAdapter Interface

## Status

Accepted

## Context

### Background and Problem Statement

cancri's brief makes one promise the entire data layer rests on: *"the app subscribes only against this interface and never knows the concrete source"* (Section C). The dashboard must render live L&S ticks, silently degrade to delayed Yahoo, and run a sanity oracle comparing the two — all without the client ever learning that Lightstreamer, protobuf, exchange suffixes, or internal instrument ids exist. That promise only holds if there is exactly one definition of what a normalised tick *is*, and that definition lives in code shared by every party that touches it.

cancri is a pnpm TypeScript monorepo with three runtime classes that all speak about ticks: `apps/web` (the vanilla-TS + Vite client), `services/feed-engine` (the always-on Cloud Run tap that owns both the L&S Lightstreamer socket and the Yahoo WS), and `functions` (Gemini normalise/confirm, logo, ISIN search). The feed-engine is the sole writer of ticks to RTDB `/quotes/{isin}` and `/feed/status` (ADR-0005); the client reads them back through the Firebase SDK. Between writer and reader sits a wire format that, once clients are subscribed to it in production, is extremely hard to change without breaking every connected dashboard mid-session.

This is the question ADR-0006 records: **where do the `Tick`, `SourceAdapter`, freshness, feed-status and inventory shapes live, and what is allowed to cross that boundary?** The decision is hard to reverse because the contract is simultaneously (a) the RTDB wire format that durable, fanned-out, offline-cached client state is keyed on, (b) the compile-time interface that two independently deployed services are built against, and (c) the seam the sanity oracle and the self-heal replay both assert in terms of. Changing the shape of `Tick` is not a refactor — it is a coordinated migration of a public data format across three deploy targets plus already-replicated client caches.

### Current Limitations

1. There is no shared type today; each of `apps/web`, `services/feed-engine` and `functions` would otherwise grow its own private notion of a price tick, an inventory row and a freshness flag.
2. Both source taps (L&S, Yahoo) emit wildly different native payloads — Lightstreamer frame fields and internal numeric ids on one side, protobuf messages and `.DE`/`.HM` exchange suffixes on the other — with no agreed normal form they must converge on.
3. Day-change is not derivable from L&S alone: the socket sends only the latest tick with no previous close (Appendix A), so `previousClose` must come from a separate daily Yahoo read, and *someone* has to own where that join happens.
4. Without a single seam, "the client never knows the source" is an aspiration enforced by code review rather than by the type system, and leaks (a raw venue code, an internal id, a `source`-specific field) become invisible until they reach the UI.

## Decision Drivers

### Primary Decision Drivers

1. **The source-agnostic promise is load-bearing**: the brief requires the app to subscribe only against the interface and never know the source. This is only enforceable if a single shared package defines the normal form and nothing source-specific is permitted to cross it.
2. **ISIN is the canonical identity end to end**: every subsystem joins on ISIN (ADR-0007). `Tick` must be ISIN-keyed as `instrumentId`, with venue carried only as display metadata, so the same key threads from inventory through the tap, RTDB node path, and client cell.
3. **Two independently deployed parties must agree at compile time**: `services/feed-engine` (writer) and `apps/web` (reader) deploy on different cadences to different runtimes. A shared compile-time contract makes a breaking change a build failure in CI rather than a silent production wire mismatch.
4. **The sanity oracle compares in-process against one normal form**: the feed-engine holds L&S and Yahoo in one process specifically to compare prices in-memory (ADR-0003). That comparison is only well-defined if both adapters normalise to the *same* `Tick` before the oracle sees them.
5. **The contract is the RTDB wire format**: because the tick *is* the durable, fanned-out RTDB payload (ADR-0004/0005), its shape change is a public-data-format migration. The seam must be deliberately small and stable.

### Secondary Decision Drivers

1. **Two-layer freshness**: the brief distinguishes `live` vs `delayed` at the source level, but the client also needs staleness (a `live` source that stopped ticking is not fresh). The contract must express both layers without leaking source mechanics.
2. **Hub-computed derived fields**: `dayChangeAbs` / `dayChangePct` must always be computed at the feed-engine from `lastPrice` and a `previousClose` baseline, never trusted from a source, so the client renders identical numbers regardless of which adapter is live.
3. **Server-side-only source internals**: secrets and source logic live server-side (brief Section C, ADR-0002 — Functions cannot hold sockets). The contract is the clean public face that lets the client stay dumb.
4. **Single import seam keeps the monorepo honest**: one `packages/data-contracts` imported by all three runtime classes localises every cross-cutting schema change to one reviewable place.

## Considered Options

### Option 1: One shared TS contract package, ISIN-keyed Tick, adapters normalise internally

**Description**: A single `packages/data-contracts` exports the `Tick` type, the `SourceAdapter` interface, the `freshness` enum, the `feed/status` shape and the inventory schema. Every `SourceAdapter` implementation (L&S, Yahoo) maps its native payload to `Tick` *inside the adapter*; nothing source-specific is ever exported. `apps/web`, `services/feed-engine` and `functions` all depend on this one package and on nothing source-specific from each other.

**Technical Characteristics**:
- `Tick` is ISIN-keyed (`instrumentId: ISIN`), with `lastPrice`, hub-computed `dayChangeAbs`/`dayChangePct`, `timestamp`, `source`, and a two-layer `freshness` (`live | delayed` source class plus a staleness signal); `venue` is carried as display metadata only.
- `SourceAdapter` is the source-agnostic interface the feed-engine programs against; each adapter owns its own symbol/venue mapping and protocol internals and emits only `Tick`.
- Schemas can be expressed as `zod` (or equivalent) so the same definition yields both the compile-time type and an optional runtime parse at the RTDB read/write boundary.
- `previousClose` enters via a daily Yahoo read and is supplied to the adapter layer so day-change is well-defined even when `lastPrice` is LIVE from L&S.
- The package is the only seam: the dependency graph forbids `apps/web` from importing anything in `services/feed-engine` or any source module.

**Advantages**:
- Enforces the brief's "never knows the source" promise structurally, not by convention.
- A breaking shape change fails CI for both writer and reader, surfacing migration cost before deploy.
- The sanity oracle and the self-heal replay both assert against one unambiguous normal form.
- ISIN threads end to end; the RTDB node path, inventory row and tick all share one key.
- One reviewable location for every cross-cutting schema change.

**Disadvantages**:
- The contract is genuinely hard to evolve: once clients hold the wire format in offline cache, any breaking change is a coordinated public-format migration (the reversibility cost is real, not theoretical).
- Tends to accrete: the temptation to add "just one" source-tinged optional field must be actively resisted in review.
- A shared package adds a build/versioning unit to the monorepo and couples deploy ordering for breaking changes.

**Risk Assessment**:
- **Technical Risk**: Low. A shared TS types package is a well-trodden monorepo pattern; the risk is design discipline, not feasibility.
- **Schedule Risk**: Low. The package is small and front-loaded; it unblocks all three runtimes early.
- **Ecosystem Risk**: Low. Plain TypeScript plus an optional `zod`; no provider lock-in beyond the language.

### Option 2: Per-area duplicated types (drift between client and server)

**Description**: Each of `apps/web`, `services/feed-engine` and `functions` keeps its own local definition of a tick, inventory row and freshness flag, kept "in sync" by discipline and the RTDB JSON acting as an informal contract.

**Technical Characteristics**:
- No shared package; the RTDB JSON node is the only de facto agreement.
- Each area free to shape its own structs, with a mapping layer at every boundary.
- Synchronisation is manual and review-driven.

**Advantages**:
- Zero shared build unit; each area deploys with no cross-package coupling.
- Each team can shape types to local convenience without negotiating a common schema.

**Disadvantages**:
- The writer and reader inevitably drift; a field renamed in the feed-engine silently mismatches the client with no compile-time failure.
- The "never knows the source" promise is unenforceable — nothing stops a source-tinged field leaking into the client's local type.
- The sanity oracle has no canonical normal form to compare against; "within X% of reference" becomes ambiguous across diverging shapes.
- Bugs surface in production as malformed ticks rather than as red CI.

**Risk Assessment**:
- **Technical Risk**: High. Silent writer/reader drift on a high-frequency public wire format is the most likely and most damaging failure mode.
- **Schedule Risk**: Medium. Cheap to start, but recurring sync bugs and boundary mapping tax every later change.
- **Ecosystem Risk**: Low. No new dependencies, but no leverage either.

### Option 3: Source-specific payloads reaching the client

**Description**: The feed-engine forwards lightly-wrapped native source payloads (Lightstreamer frame fields / internal ids, or Yahoo protobuf-derived objects with exchange suffixes) to RTDB, and the client interprets source internals directly.

**Technical Characteristics**:
- `Tick` becomes a thin envelope around source-native fields; the client branches on `source` to read them.
- L&S internal instrument ids and `.DE`/`.HM`-style venue suffixes appear in client code.
- Normalisation, if any, happens in the client.

**Advantages**:
- Minimal server-side transform; the tap forwards what it already has.
- All source detail is available to the client without re-deriving anything.

**Disadvantages**:
- Directly violates the brief: it leaks Lightstreamer/protobuf internals and source ids into the client, the exact thing Section C forbids.
- Couples the UI to L&S protocol quirks, so a self-heal protocol fix (ADR-0009) can ripple into the frontend — defeating the bounded break surface.
- Degradation L&S→Yahoo becomes a visible client rewrite instead of a transparent swap behind one shape.
- Two source dialects in the client multiply rendering and freshness logic.

**Risk Assessment**:
- **Technical Risk**: High. Source internals in the client couple the UI to an undocumented, self-healing protocol; a tap fix can break the dashboard.
- **Schedule Risk**: Medium. Faster to first tick, but every source change and the degradation path cost far more later.
- **Ecosystem Risk**: High. Hard-binds the client to Lightstreamer 6 and Yahoo protobuf specifics, the most volatile parts of the system.

### Option 4: Runtime schema validation only, no shared compile-time types

**Description**: Define the tick/inventory/feed-status shapes as a runtime schema (e.g. JSON Schema or a standalone `zod` validator) checked at the RTDB boundary, but expose no shared TypeScript types — each area infers or hand-writes its own static types.

**Technical Characteristics**:
- A runtime validator gates reads/writes; static typing is per-area and not derived from one source.
- The contract is enforced at runtime, not at build.
- Validation failures are caught at the edge during execution.

**Advantages**:
- Catches malformed payloads at the wire boundary at runtime, including from drifting writers.
- No compile-time coupling between independently built areas.

**Disadvantages**:
- Moves contract violations from CI (cheap, pre-deploy) to runtime (expensive, in production), on a high-frequency wire where a bad tick is user-visible.
- Without shared static types, the "never knows the source" boundary and ISIN keying are not enforced where developers actually write code.
- Duplicate hand-written types re-introduce Option 2's drift on top of the validator.
- The sanity oracle and replay still want a single canonical *type*, not just a gate.

**Risk Assessment**:
- **Technical Risk**: Medium. Runtime validation is sound, but deferring enforcement to production on a live wire is a worse failure surface than a red build.
- **Schedule Risk**: Medium. Runtime failures and ad-hoc per-area types erode the early-unblock benefit.
- **Ecosystem Risk**: Low. A standard validator library; no lock-in. (Note: the chosen option *also* uses runtime validation, but in addition to — not instead of — shared compile-time types.)

## Decision

Adopt **Option 1**: a single `packages/data-contracts` is the only shared seam between client and server. It defines `Tick`, the `SourceAdapter` interface, the `freshness` enum, the `feed/status` shape and the inventory schema, and all three runtime classes depend on it and on nothing source-specific from each other.

The implementation will use:
- **`packages/data-contracts`** as the sole cross-cutting contract, imported by `apps/web`, `services/feed-engine` and `functions`, with the monorepo dependency graph forbidding source-specific imports across the seam.
- **`Tick`** ISIN-keyed (`instrumentId: ISIN`), carrying `lastPrice`, hub-computed `dayChangeAbs`/`dayChangePct`, `timestamp`, `source`, two-layer `freshness` (`live | delayed` plus staleness), and `venue` as display metadata only.
- **`SourceAdapter`** as the source-agnostic interface; each adapter (L&S, Yahoo) owns its symbol/venue mapping and protocol internals and emits only `Tick`. Normalisation happens *inside* the adapter.
- **A daily Yahoo `previousClose` read** fed to the adapter layer so `dayChange*` is hub-computed and correct even while `lastPrice` is LIVE from L&S (which sends no close).
- **`zod`-style schemas** (or equivalent) so the same definition yields the compile-time type *and* an optional runtime parse at the RTDB write/read boundary — compile-time enforcement first, runtime validation as defence in depth.

## Consequences

### Positive

1. **Source-agnostic promise is structural**: the client cannot import source internals; "never knows the source" is enforced by the dependency graph, not by review vigilance.
2. **Drift fails the build**: a breaking change to `Tick` red-lights CI for both the feed-engine and the client, surfacing migration cost before any deploy.
3. **One normal form for oracle and replay**: the in-process sanity oracle (ADR-0003) and the offline self-heal replay (ADR-0009/0010) both assert against a single unambiguous `Tick`.
4. **ISIN threads end to end**: inventory rows, RTDB `/quotes/{isin}` paths and ticks share one canonical key (ADR-0007), so joins are trivial and unambiguous.
5. **Transparent degradation**: L&S→Yahoo failover is a swap behind one shape; the client only sees `source` and `freshness` change, never a different payload.

### Negative

1. **Genuinely hard to reverse**: once clients hold the wire format in offline cache and two services are built against it, a breaking shape change is a coordinated public-format migration across three deploy targets plus replicated caches — this reversibility cost is real and permanent.
2. **Schema accretion pressure**: the contract will attract "just one optional field" additions, including source-tinged ones; keeping it minimal requires active, ongoing review discipline.
3. **Coupled deploy ordering for breaking changes**: a breaking bump must roll out writer-then-reader (or be made additive) in a deliberate sequence, adding release coordination the duplicated-types option would not.
4. **Front-loaded design cost**: the package must be designed well early, before all consumers exist, so mistakes in the normal form are expensive to unwind later.

### Neutral

1. **`previousClose` provenance is fixed**: day-change baseline is always a daily Yahoo read, even in LIVE mode — a deliberate cross-source join, not an incidental detail.
2. **Optional runtime validation**: the same schema can gate the RTDB boundary at runtime, but this is defence in depth layered on top of compile-time types, not the primary enforcement.
3. **`venue` is display-only**: venue/exchange travels as metadata for the UI and never participates in identity or joins.

## Decision Outcome

The objectives are met because a single `packages/data-contracts` makes the brief's central promise — the app subscribes only against the interface and never knows the source — enforceable by the type system and the monorepo dependency graph rather than by convention. ISIN-keyed `Tick`, hub-computed day-change, and a daily Yahoo `previousClose` baseline give the client identical, correct numbers regardless of which adapter is live, and give the in-process oracle and the offline replay one normal form to assert against. Source internals stay quarantined inside each adapter (and, for L&S, inside the bounded break surface of ADR-0009).

Mitigations:
- For the hard-to-reverse risk: prefer additive, non-breaking evolution; version the contract and treat any breaking change as a planned writer-then-reader migration with the runtime validator catching mismatches at the boundary.
- For schema accretion: enforce in review that nothing source-specific crosses the seam and that new fields are justified against the brief; the dependency graph blocks source-module imports outright.
- For deploy-ordering coupling: keep changes additive by default so writer and reader can roll out independently; reserve coordinated rollouts for genuine breaking bumps.
- For front-loaded design cost: ship the package first so all three runtimes converge on it early and design errors are found while consumers are still thin.

## Related Decisions

- [ADR-0002: Runtime Classes](0002-three-runtime-classes-execution-model.md) - establishes the three runtime classes (`apps/web`, `functions`, Cloud Run) that all import this contract; Functions cannot hold sockets, which is why the tap is separate.
- [ADR-0003: Feed-Engine](0003-feed-engine-single-process-singleton.md) - the always-on tap whose adapters normalise to `Tick`; its in-process sanity oracle relies on this single normal form.
- [ADR-0004: Datastore Split](0004-datastore-split-firestore-book-rtdb-wire.md) - the inventory schema (Firestore book) and tick shape (RTDB wire) both defined here.
- [ADR-0005: Transport](0005-realtime-transport-rtdb-tick-bus.md) - `Tick` *is* the RTDB `/quotes/{isin}` and `/feed/status` wire format written by the feed-engine and read by the client.
- [ADR-0007: ISIN Canonical Identity](0007-isin-resolution-llm-proposes-resolver-disposes.md) - `Tick.instrumentId` is ISIN; this contract pins that keying across all subsystems.
- [ADR-0009: ls-protocol Module](0009-ls-protocol-break-surface-isolation.md) - quarantines L&S source internals so a protocol fix never crosses this seam into the client.
- [ADR-0010: Self-Heal](0010-self-heal-governance-pr-deterministic-gate.md) - the offline replay asserts that recovered frames produce correct `Tick` prices against this normal form.

## Links

- cancri Implementation Brief — `design/IMPLEMENTATION_BRIEF.md`, Section C (Live price data layer; the source adapter interface and the "never knows the source" requirement).
- cancri Implementation Brief — Appendix A (L&S: internal instrument ids, latest-tick-only / no history, the bounded break surface).
- cancri Implementation Brief — Appendix B (Yahoo: protobuf encoding, `.DE`/`.HM` exchange suffixes, ~15-min delayed German venues, sanity-oracle role).

## More Information

- **Date:** 2026-06-27
- **Source:** cancri Implementation Brief (Section C, Appendices A and B); cross-cutting decisions 5 and 6.
- **Related ADRs:** 0002, 0003, 0004, 0005, 0007, 0009, 0010.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created, awaiting implementation.

**Action Required:** Implement decision and audit.
