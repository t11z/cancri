---
title: "Frontend Vanilla TS + Vite, Single rAF Loop"
description: "Build the terminal in strict TypeScript on Vite with one rAF loop over a static DOM skeleton and a hot/cold two-tier state split."
type: adr
category: architecture
tags: [frontend, rendering]
status: accepted
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [typescript, vite, requestanimationframe, firebase-rtdb]
---

# ADR-0011: Frontend Vanilla TS + Vite, Single rAF Loop

## Status

Accepted

## Context

### Background and Problem Statement

cancri is a read-only, access-gated live-portfolio terminal. The visible surface
is small — roughly a dozen instrument rows — but it is in continuous motion for the
entire trading day. Each row carries a directional tick-flash (flash-alpha decay), a
number-roll that lerps the displayed price toward the latest value, a live-drawn
sparkline whose path must be recomputed as ticks arrive, plus freshness/source
chrome (live vs delayed). The data feeding this motion is high frequency: the
feed-engine (ADR-0003) is the sole writer of normalised ticks to RTDB `/quotes/{isin}`
(overwrite-in-place) and a global `/feed/status`, and the client subscribes directly
to those nodes over the Firebase SDK (ADR-0005). Several instruments can update many
times per second during volatile periods.

The design handover is the source of truth for everything visual, interactive, and
animated; this brief defines only functionality and interfaces. That handover is
imperative by nature — it specifies per-frame alpha decay, an easing on the number
transition, and a redrawn sparkline. The implementer's free choice is the rendering
substrate beneath that motion: framework, state model, and the loop that drives it.

The hard part — and the reason this decision resists cheap reversal — is that the
render model and the state model co-determine each other. A frontend framework choice
dictates how a 60fps stream of ticks reaches the DOM: through a reactive store and a
diff/reconcile pass, or through direct mutation of pre-built nodes. That choice
propagates into how `packages/data-contracts` `Tick` values (ADR-0006) are consumed,
how the sparkline buffers are held, and how the whole motion layer is authored.
Reversing it after the motion layer exists means re-authoring the hot path, not
swapping a dependency — which is why this is recorded as an architecture ADR rather
than a tooling note.

### Current Limitations

1. The design reference ships as a React component that calls a full-tree
   `forceUpdate` at 60fps. That pattern reconciles the entire row set every frame
   regardless of which prices actually changed, and is acceptable for a short demo
   but wrong for an all-day terminal where the same tree is repainted for hours.
2. Routing every RTDB tick through a reactive store turns each price change into a
   store write plus a dependency-tracked re-render, putting framework bookkeeping on
   the critical path of the very thing that must stay inside the frame budget.
3. There is no existing frontend codebase to preserve; the only inheritance is the
   reference's structure, so any framework decision is greenfield but motion-shaped.

## Decision Drivers

### Primary Decision Drivers

1. **Frame budget under sustained load**: ~12 rows animating every frame for hours.
   The render path (flash-alpha, number-roll lerp, sparkline recompute) must fit in
   ~16ms with headroom, and nothing framework-side may sit between a tick and a pixel.
2. **The render model is already imperative**: per-frame alpha decay and lerp are
   continuous mutations of existing nodes, not declarative re-derivations of a tree.
   The substrate should match that shape rather than fight it with a VDOM diff.
3. **Hot/cold separation of state**: cold/UI state (inventory rows, selection, source
   status) changes rarely and human-paced; hot/tick state (lastPrice, day-change,
   sparkline buffer) changes at wire speed. These must not share an update mechanism,
   or the cheap path pays for the expensive one.
4. **Handover authority**: tokens and motion constants derive from the handover JSON
   so the handover stays authoritative; the build must consume them, not re-encode them.

### Secondary Decision Drivers

1. **Read-only client, no source secrets**: the client only subscribes to normalised
   ticks; source logic and credentials are server-side (ADR-0002/0003). The frontend
   needs no server runtime, no SSR, and no secret handling, which removes any pull
   toward a heavier meta-framework.
2. **Firebase-only platform**: Firebase Hosting serves static assets; a Vite static
   build drops straight onto it with no adapter.
3. **Small, auditable surface**: a single contracts seam (ADR-0006) plus a thin DOM
   layer keeps the client small and reviewable, which matters for a single-maintainer
   self-healing system.
4. **Bundle and cold-start**: a minimal dependency tree means a small bundle and fast
   first paint for a terminal that is opened and left running.

## Considered Options

### Option 1: Vanilla TS + Vite, single rAF render loop, hot/cold state split

**Description**: Strict TypeScript built with Vite. The UI is a static DOM skeleton
built once from the confirmed inventory. A single `requestAnimationFrame` loop is the
only animation driver: each frame it reads the current hot state and mutates the
existing nodes in place (flash-alpha, number-roll lerp, sparkline path). State is split
into a cold/UI tier (rarely changed, may use ordinary event handlers) and a hot/tick
tier (a plain mutable structure the RTDB subscription writes into and the rAF loop
reads). Motion constants and tokens are generated from the handover JSON at build time.

**Technical Characteristics**:
- One rAF loop owns all timing; RTDB callbacks only write hot state, they never render.
- DOM nodes are created once and mutated; no per-frame allocation, no diff/reconcile.
- Hot state is decoupled from cold state so wire-speed writes never touch UI structure.
- `packages/data-contracts` `Tick`/freshness consumed directly; no framework adapter.
- Static Vite build deploys to Firebase Hosting with no SSR or server runtime.

**Advantages**:
- Tightest possible frame path: tick → hot-state write → next-frame node mutation.
- The substrate matches the already-imperative motion model with zero impedance.
- Smallest bundle and dependency surface; nothing to keep on the critical path.
- Full control over coalescing: many ticks between frames collapse to one paint.

**Disadvantages**:
- No framework guard-rails: component structure, lifecycle, and cleanup are by hand.
- Manual DOM wiring is more verbose and easier to get subtly wrong than declarative
  templates; risk of ad-hoc patterns without discipline.
- Smaller hiring/onboarding pool comfortable with hand-written rAF/DOM code than with
  a mainstream framework.

**Risk Assessment**:
- **Technical Risk**: Low. The hot path is fully controlled and the motion model is
  well understood; the main exposure is self-inflicted structural drift, not the loop.
- **Schedule Risk**: Medium. More bespoke UI plumbing to author up front than a
  framework's scaffolding would provide.
- **Ecosystem Risk**: Low. TypeScript + Vite are first-class and stable; no framework
  churn to track, but also no component ecosystem to lean on.

### Option 2: React as in the reference (full-tree forceUpdate at 60fps)

**Description**: Keep the reference's stack — React driving the row set, re-rendering on
every tick, in the limit via a 60fps `forceUpdate` or equivalent state churn.

**Technical Characteristics**:
- Declarative component tree; ticks flow through state and trigger reconciliation.
- VDOM diff runs each frame to reconcile the (largely unchanged) row structure.
- Refs/escape hatches needed to touch the canvas sparkline outside the VDOM.

**Advantages**:
- Closest to the existing reference; least conceptual translation to start.
- Mature ecosystem, familiar component model, large contributor pool.
- Declarative structure is easy to read for the cold/UI parts of the screen.

**Disadvantages**:
- A VDOM buys nothing here: the structure barely changes, only values do, so the diff
  is pure overhead on the hot path.
- 60fps full-tree updates are the documented anti-pattern for an all-day terminal;
  reconciliation cost scales with rows and frames for no benefit.
- Real low-latency motion ends up in refs/imperative escapes anyway, so you pay for
  the framework and then bypass it for the part that matters.

**Risk Assessment**:
- **Technical Risk**: High. The framework actively contends with the hot path; hitting
  the frame budget requires fighting React rather than using it.
- **Schedule Risk**: Medium. Fast to stand up, but tuning the hot path (memoisation,
  refs, escape hatches) consumes the saved time and more.
- **Ecosystem Risk**: Low. React is stable and ubiquitous; this is the safe axis.

### Option 3: Svelte 5 runes (reactivity for cold state, hot path kept outside)

**Description**: Svelte 5 with runes for the cold/UI tier, compiling components to
efficient imperative updates, while deliberately keeping the 60fps tick hot-path outside
reactivity via a manual rAF loop and direct node/canvas mutation.

**Technical Characteristics**:
- Compiler emits targeted DOM updates; no runtime VDOM.
- Runes give clean reactivity for inventory/selection/status (the cold tier).
- Hot path is an explicit non-reactive rAF loop mutating nodes, bypassing runes.

**Advantages**:
- Excellent ergonomics and small output for the cold/UI surface.
- Compiled fine-grained updates are far closer to the imperative ideal than a VDOM.
- The hot/cold split this ADR wants maps naturally onto "reactive cold, manual hot".

**Disadvantages**:
- Two mental models in one app: reactive for cold, deliberately non-reactive for hot,
  with a discipline boundary that is easy to erode (a tick accidentally made reactive).
- Adds a compiler/toolchain dependency and framework version to track for a UI whose
  hot path is hand-written regardless.
- Svelte 5 runes are comparatively new; less battle-tested than the alternatives.

**Risk Assessment**:
- **Technical Risk**: Medium. The hot path is fine; the risk is the porous boundary
  between reactive and non-reactive state being crossed under time pressure.
- **Schedule Risk**: Low. Strong ergonomics make the cold surface fast to build.
- **Ecosystem Risk**: Medium. Svelte is healthy but smaller, and runes are recent.

### Option 4: Preact + signals (smallest path from the reference)

**Description**: Preact as a lightweight React-compatible renderer plus `@preact/signals`,
routing tick updates through fine-grained signals so only bound text nodes update,
keeping the reference's component shape with a far smaller runtime.

**Technical Characteristics**:
- Preact VDOM for structure; signals for fine-grained value binding.
- A signal per animated value can update its bound node without re-rendering the tree.
- Drop-in-ish from React via `preact/compat`, preserving reference structure.

**Advantages**:
- Smallest migration from the React reference while shedding most of React's weight.
- Signals can pin updates to individual nodes, avoiding full-tree reconciliation.
- Tiny runtime; good bundle size; familiar component ergonomics.

**Disadvantages**:
- Still a VDOM/component runtime between ticks and pixels; signals reduce but do not
  remove framework bookkeeping on the hot path.
- Per-value signals at wire speed create their own write/notify overhead and a lot of
  fine-grained subscriptions for the sparkline buffer specifically.
- The canvas sparkline still needs an imperative escape, so the framework helps least
  exactly where the cost is highest.

**Risk Assessment**:
- **Technical Risk**: Medium. Signals are a good fit for scalar price text but awkward
  for the buffer-driven sparkline, where manual drawing wins anyway.
- **Schedule Risk**: Low. Closest to the reference; quick to a working screen.
- **Ecosystem Risk**: Medium. Preact and signals are solid but a smaller ecosystem and
  occasionally lag React-compat edges.

## Decision

Adopt **Option 1: Vanilla TS + Vite with a single rAF render loop and a hot/cold
state split**. The terminal is written in strict TypeScript, built and bundled by Vite,
and deployed as static assets to Firebase Hosting.

The implementation will use:
- **A static DOM skeleton** built once from the confirmed inventory; rows and their
  child nodes are created up front and never re-created per frame.
- **One `requestAnimationFrame` loop** as the sole animation driver, mutating existing
  nodes in place each frame for flash-alpha decay, number-roll lerp, and sparkline path.
- **A two-tier state model**: a cold/UI tier (inventory, selection, source/freshness
  chrome) updated by ordinary handlers, and a hot/tick tier (lastPrice, day-change,
  sparkline ring buffer) held as a plain mutable structure that the RTDB subscription
  writes and the rAF loop reads — RTDB callbacks never render directly.
- **`packages/data-contracts`** (ADR-0006) `Tick`, freshness enum and feed-status shape
  consumed directly with no framework adapter; ISIN (ADR-0007) is the row/quote join key.
- **Build-time tokens generated from the handover JSON**, keeping the handover the single
  authority for visual and motion constants.

## Consequences

### Positive

1. **Frame budget protected by construction**: with no VDOM diff and no reactive store
   on the tick path, the only per-frame work is the motion the handover actually
   specifies, leaving headroom across all rows for the trading day.
2. **Substrate matches the model**: an imperative loop expresses imperative motion
   directly, so the code reads as what it does rather than as a fight with a framework.
3. **Natural tick coalescing**: because rendering is frame-driven and decoupled from
   RTDB callbacks, a burst of overwrite-in-place ticks between two frames collapses to a
   single paint, turning wire-speed updates into bounded render work.
4. **Minimal surface**: small bundle, fast first paint, few dependencies, and a thin,
   auditable client that imports nothing source-specific across the contracts seam.

### Negative

1. **No framework guard-rails**: component boundaries, lifecycle, event cleanup, and the
   hot/cold discipline are all conventions the team must hold by hand; nothing enforces
   them, so structural drift is a standing risk.
2. **More bespoke UI plumbing**: building list rendering, state binding, and teardown
   from primitives is more code and more chances for subtle leaks than a framework's
   scaffolding, with a real up-front schedule cost.
3. **Reversal is genuinely medium-cost, not free**: because the motion layer is authored
   against the imperative substrate, moving to a framework later means re-authoring the
   hot path and its state wiring, not swapping a dependency — the contracts seam limits
   the blast radius but does not eliminate it.
4. **Narrower contributor familiarity**: hand-written rAF/DOM code suits fewer
   contributors than a mainstream framework, raising the onboarding bar.

### Neutral

1. **Charting/sparkline technique stays open**: canvas or lightweight path drawing is an
   implementation detail under the rAF loop, decided separately.
2. **Cold-tier ergonomics are a local choice**: small helpers or a thin templating
   utility for the cold/UI tier can be added without touching the hot path.
3. **The contracts seam is unaffected**: ADR-0006 remains the only client/server seam
   regardless of this rendering choice, so a future framework swap is bounded by it.

## Decision Outcome

The objectives are met because the hot path — the only part of the screen under
sustained load — is driven by a single rAF loop mutating pre-built nodes, with RTDB
ticks writing a plain hot-state structure that the loop reads. This keeps framework
bookkeeping entirely off the critical path, satisfies the frame budget for ~12
all-day-animating rows, and matches the imperative motion the handover specifies. The
hot/cold split ensures human-paced UI changes never pay wire-speed costs and vice versa,
and build-time token generation keeps the handover authoritative.

Mitigations:
- For the missing framework guard-rails, impose lightweight conventions: a single rAF
  loop module, a typed hot-state structure with a narrow write API used only by the RTDB
  subscription, and explicit row create/destroy helpers — so the hot/cold boundary is
  visible and reviewable.
- For the medium reversal cost, keep all source/contract coupling behind
  `packages/data-contracts` (ADR-0006) and keep render logic free of source specifics, so
  a later framework adoption is re-authoring a known, bounded layer rather than untangling
  cross-cutting state.
- For the bespoke-plumbing schedule cost, build the row and state primitives once,
  early, with tests, and reuse them across all rows.
- For contributor familiarity, document the loop, the two-tier state model, and the
  conventions in the client package so the model is learnable rather than folklore.

## Related Decisions

- [ADR-0002: Runtime Classes](0002-three-runtime-classes-execution-model.md) - Establishes the read-only,
  server-side-secrets topology that lets the frontend be a pure static client.
- [ADR-0003: Feed Engine](0003-feed-engine-single-process-singleton.md) - The sole writer of the ticks this loop
  renders; defines the producer side of the wire.
- [ADR-0004: Datastore Split](0004-datastore-split-firestore-book-rtdb-wire.md) - Firestore book vs RTDB wire; the
  client reads cold inventory from one and hot ticks from the other.
- [ADR-0005: Transport](0005-realtime-transport-rtdb-tick-bus.md) - RTDB as the tick bus the client subscribes to;
  the source of the hot-state writes.
- [ADR-0006: Tick Contract](0006-tick-schema-and-source-adapter-contract.md) - The single shared seam this frontend
  imports; bounds any future rendering-stack change.
- [ADR-0007: ISIN Canonical Identity](0007-isin-resolution-llm-proposes-resolver-disposes.md) - The join key
  between inventory rows and `/quotes/{isin}` nodes.

## Links

- cancri implementation brief — `design/IMPLEMENTATION_BRIEF.md`, sections F (Realtime UI)
  and B (onboarding/confirm screen), and the non-goals (read-only display).
- cancri implementation brief — Appendix A (L&S primary source) and Appendix B (Yahoo
  fallback/oracle), which define the upstream feed the client renders.
- The design handover (referenced by the brief as the source of truth for all
  visual/interactive/animated behaviour) — tick flash, number transition, sparkline draw.

## More Information

- **Date:** 2026-06-27
- **Source:** cancri decomposition pass; `design/IMPLEMENTATION_BRIEF.md`.
- **Related ADRs:** 0002, 0003, 0004, 0005, 0006, 0007.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created, awaiting implementation.

**Action Required:** Implement decision and audit.
