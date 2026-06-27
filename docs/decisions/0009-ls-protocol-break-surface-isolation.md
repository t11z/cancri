---
title: "Quarantine the L&S Break Surface in a Versioned ls-protocol Module"
description: "Confine the L&S handshake, frame decode and ISIN-to-id mapping to one versioned, config-driven ls-protocol module so a self-heal PR has a bounded blast radius."
type: adr
category: architecture
tags: [feed-engine, self-heal, protocol, lightstreamer]
status: accepted
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [typescript, lightstreamer, websocket, json]
---

# ADR-0009: Quarantine the L&S Break Surface in a Versioned ls-protocol Module

## Status

Accepted

## Context

### Background and Problem Statement

cancri's primary price source is L&S (ls-tc.de), the only feed that delivers truly live, cent-accurate ticks (brief §C). It rides "Lightstreamer 6", a deprecated, undocumented legacy protocol with no public API and only a browser-resident JS client as reference (Appendix A). The brief is explicit that this tap *will* break when the source silently changes its protocol, and §D mandates a self-healing mechanism: a probe detects the break, a Cloud Run Job drives a real browser to capture raw frames alongside the simultaneously-rendered price, and an agent opens a reviewable PR whose fix is gated by an offline deterministic frame-to-price replay (no auto-merge).

For that self-heal loop to be tractable, the thing it repairs must be *bounded*. Appendix A enumerates the exact break surface: session-creation handshake params (the `LS_cid` magic value, the `WALLSTREETONLINE` adapter set, polling/idle params), connection sensitivities (required subprotocol, required `https://www.ls-tc.de` origin, fixed bytes at a frame position, `\r\n` line endings), frame byte offsets, and the ISIN→internal-instrument-id remapping resolved via L&S's instrument search endpoint. If these details are smeared across the socket lifecycle, fan-out, freshness logic and health probes inside the always-on feed-engine (ADR-0003), then a protocol flip touches *everything*, the self-heal agent has an unbounded diff to reason about, and the deterministic regression has no stable seam to pin against.

This decision records how that break surface is structured in code: a single versioned `ls-protocol` module, driven by a `protocol.config.<v>.json`, behind a narrow `ProtocolModule` interface, such that the socket transport, the tick fan-out to RTDB (ADR-0005) and the sanity-oracle/health code never import decode internals.

This is **hard to reverse**. The `ProtocolModule` interface becomes the contract that the self-heal Cloud Run Job, the offline replay harness in CI, the fixture corpus (the data layer's audit trail per brief §3), and the GitHub App PR generator all target. Once self-heal automation, fixtures and CI gating are written against this seam, changing the seam means rewriting the regression base and the agent's edit surface simultaneously — the cost is not the module, it is the entire maintenance loop wired to it.

### Current Limitations

1. There is no existing implementation; the constraint is structural. The undocumented protocol means *some* code is guaranteed to require periodic correction, and without an explicit boundary that code has no natural home — it would diffuse into the transport and health layers of the feed-engine.
2. The brief requires the self-heal fix target to be "limited to handshake parameters, frame decode, and id-mapping," but a target can only be limited if the code physically isolates exactly those three concerns and nothing else.
3. The deterministic verification ("the proposed parser is correct iff it reproduces the rendered prices from the recorded raw frames") needs a pure, side-effect-free decode function it can replay offline against fixtures; sockets, timers and RTDB writes cannot sit inside the unit under regression.
4. Protocol changes must be expressible *without* a code change where possible (a parameter flip such as a new `LS_cid` or a new adapter set), otherwise every trivial break forces a full code-review cycle instead of a config bump.

## Decision Drivers

### Primary Decision Drivers

1. **Bounded self-heal blast radius**: ADR-0010's automation must touch a small, enumerable set of files. A versioned config plus pure codecs means a self-heal PR is confined to three modules + fixtures, and ideally to a single JSON config bump.
2. **Deterministic, offline regression**: §D's correctness test is "replay recorded frames → reproduce rendered prices." This demands a pure `decode(frame, config) → tick` function with no I/O, so CI can pin it against the append-only fixture corpus with no live socket.
3. **Pinned config corpus as the regression base**: each landed fix snapshots working frames + expected prices append-only (brief §D, §3 auditability). A versioned `protocol.config.<v>.json` makes "which protocol shape produced these fixtures" explicit and diffable, giving the regression a stable, versioned ground truth.
4. **The break surface is already enumerated**: Appendix A hands us the exact list of what flips. Modelling precisely that list as data (config) + thin codec is the lowest-impedance mapping from the brief to code.

### Secondary Decision Drivers

1. **Co-location constraint respected (ADR-0002/0003)**: Functions cannot hold sockets, so the L&S tap lives in the always-on feed-engine alongside Yahoo for in-memory sanity comparison. The `ls-protocol` module is a pure sub-unit of that service; isolating it does not perturb the single-process topology the oracle requires.
2. **Server-side secret/internal containment (brief §3)**: `LS_cid`, origin and adapter-set are source internals that must never reach the client. A self-contained server-side module keeps them behind the `data-contracts` seam (ADR-0006); only normalised `Tick`s cross to RTDB.
3. **ISIN as the canonical key (ADR-0007)**: the per-source ISIN→internal-id remapping is L&S-specific and belongs *inside* the adapter, not in shared code. The module owns that mapping so the rest of cancri only ever speaks ISIN.
4. **Swap-by-active-version operability**: keeping multiple `protocol.config.<v>.json` versions and selecting the active one lets a merged fix roll forward (and back) as data, decoupling protocol revisions from feed-engine deploys.

## Considered Options

### Option 1: Data-driven config + thin pure adapters behind a `ProtocolModule` interface, swap by active version

**Description**: One `ls-protocol` module exposes a narrow `ProtocolModule` interface — handshake assembly, frame decode, and ISIN-to-id mapping — all parameterised by a `protocol.config.<v>.json` (LS_cid, adapter set, subprotocol/origin, frame byte offsets, line ending, id-map rules). The socket lifecycle, RTDB fan-out and health/sanity code depend only on the interface and the emitted `Tick`s; they never import decode internals. An `activeVersion` pointer selects which config the running feed-engine uses.

**Technical Characteristics**:
- `decode(frame, config) → Tick` is a pure function: no sockets, timers, or RTDB writes inside the unit under regression.
- Handshake parameters and connection sensitivities are values in versioned JSON, not literals in transport code.
- The id-mapping (ISIN → L&S internal id, via the instrument search endpoint) is owned inside the module; callers pass ISIN only.
- Self-heal edit surface = three modules (handshake, codec, id-map) + the config + fixtures; everything else is off-limits to a self-heal PR.
- The fixture corpus pairs raw frames with expected prices under a named config version, forming the offline replay base in CI.

**Advantages**:
- A common protocol flip (new magic value, new adapter set, changed origin) is a *config bump*, not a code change — fastest possible mean-time-to-repair.
- The deterministic regression has a clean, pure target and a versioned ground truth; CI can gate with no live source.
- Self-heal PRs are small, reviewable, and bounded exactly to Appendix A's surface — satisfying §D's "bounded break surface" literally.
- Source internals/secrets stay server-side behind one boundary; only `Tick`s cross `data-contracts`.
- Roll-forward/roll-back of protocol revisions is a data operation (active-version swap), decoupled from feed-engine code deploys.

**Disadvantages**:
- A config schema rich enough to express handshake + byte offsets + id-map rules is itself an artefact that must be designed, validated and versioned; an over-rigid schema can fail to express a genuinely novel break, forcing a codec code change anyway.
- Indirection cost: contributors must understand the config-driven model before they can read "what the protocol does," which is less immediately legible than inline code.
- The `ProtocolModule` interface and config schema are the hard-to-reverse commitments — the whole self-heal/CI/fixture apparatus is built on them.

**Risk Assessment**:
- **Technical Risk**: Medium. The pure-codec boundary is well-understood, but designing a config schema expressive enough for an *undocumented* protocol's future mutations is a genuine unknown.
- **Schedule Risk**: Medium. Up-front schema + interface + fixture-harness design is more work than inlining, and it gates ADR-0010.
- **Ecosystem Risk**: Low. Plain TypeScript + JSON, no external runtime dependency; the community Python reimpl is consulted as reference documentation only.

### Option 2: Inline the protocol details throughout the tap

**Description**: Implement L&S directly inside the feed-engine's socket code — handshake params as literals at the connection site, frame decoding interleaved with the read loop, id-mapping wherever a subscription is created. No dedicated module, no config file.

**Technical Characteristics**:
- Protocol constants (`LS_cid`, adapter set, origin, byte offsets) live at their point of use.
- Decode logic is entangled with socket reads, backpressure and reconnect handling.
- No pure decode function; behaviour is observable only against a live or mocked socket.

**Advantages**:
- Lowest initial effort; no interface or schema to design.
- Maximally legible *locally* — the protocol behaviour sits next to the socket that uses it.
- No indirection layer to learn.

**Disadvantages**:
- A protocol flip touches the transport, reconnect and possibly health code — the self-heal blast radius is unbounded, directly violating §D's "bounded break surface."
- No pure unit for the deterministic replay; the regression cannot be offline or clean, undermining ADR-0010's no-auto-merge gate.
- An automated self-heal agent would have to edit live socket-handling code, the single highest-risk code in the always-on feed-engine.
- Every trivial parameter change requires a full code change + review cycle; no config-bump fast path.

**Risk Assessment**:
- **Technical Risk**: High. Couples the fragile, mutating protocol to the always-on socket the sanity oracle depends on; a bad self-heal edit can crash the feed.
- **Schedule Risk**: High over the project lifetime. Cheap to start, but every break costs a full edit/review/deploy cycle and threatens unrelated transport code.
- **Ecosystem Risk**: Low. No new dependencies — but the maintenance model it implies is the actual liability.

### Option 3: Treat the community Python reimplementation as a runtime dependency

**Description**: Run `VIEWVIEWVIEW/Lightstreamer-6.1-python` as a live component (a sidecar or invoked subprocess), delegating handshake and decode to it rather than reimplementing the protocol in TypeScript.

**Technical Characteristics**:
- Introduces a Python runtime and a cross-language boundary inside (or beside) the feed-engine.
- Protocol behaviour is owned by an external, third-party, unversioned-for-our-purposes project.
- Ticks would cross a process/IPC boundary before reaching the in-process sanity oracle.

**Advantages**:
- Reuses an existing working reference instead of writing a codec from scratch.
- Potentially faster to a first live tick.

**Disadvantages**:
- Breaks the mandatory single-process co-location (ADR-0002/0003): the sanity oracle must compare L&S vs Yahoo *in-memory* with no cross-service hop; a Python sidecar reintroduces exactly that hop.
- A second runtime in the always-on Cloud Run service inflates the image, cold-path complexity and operational surface.
- The break surface is now *outside* our repo — self-heal cannot edit it, fixtures cannot pin it, and CI cannot gate it; §D's self-heal loop becomes impossible against a dependency we do not control.
- The reference is itself a community reimplementation of an undocumented protocol; it can break the same way and on someone else's schedule.

**Risk Assessment**:
- **Technical Risk**: High. Cross-language IPC inside the latency-sensitive feed-engine and loss of in-memory oracle comparison.
- **Schedule Risk**: Medium. Fast initially, but the self-heal mechanism (a hard requirement) cannot be built on it, so the saved time is reborrowed later.
- **Ecosystem Risk**: High. Hard dependence on an unmaintained third-party reimpl of an undocumented protocol, outside our regression control.

### Option 4: A general protocol parser without a pinned config corpus

**Description**: Build a flexible/heuristic decoder in TypeScript that adapts to frame shapes at runtime, without a versioned `protocol.config.<v>.json` or an append-only fixture corpus as ground truth.

**Technical Characteristics**:
- Decode behaviour is driven by runtime heuristics rather than a pinned, versioned config.
- No single canonical "this version produced these fixtures" artefact.
- Verification would compare against whatever reference is available at the moment, not a frozen corpus.

**Advantages**:
- Might absorb minor protocol drift without any human intervention.
- Fewer explicit config artefacts to maintain.

**Disadvantages**:
- No deterministic regression base: §D requires "reproduces the rendered prices from the recorded raw frames," which presupposes a *pinned* fixture/config pair. Heuristics make "correct" unfalsifiable.
- Silent mis-decode risk: a flexible parser can produce plausible-but-wrong prices, defeating the cent-accuracy that justifies L&S as primary and corrupting the sanity oracle's own baseline.
- The self-heal PR has nothing concrete to diff against; the no-auto-merge gate loses its objective pass/fail criterion.
- Auditability (brief §3) erodes — the fixture corpus is meant to be protocol documentation by example, which a config-less heuristic does not produce.

**Risk Assessment**:
- **Technical Risk**: High. Non-determinism and silent mis-decode in the cent-accurate primary path.
- **Schedule Risk**: Medium. Heuristic tuning and chasing false positives is open-ended.
- **Ecosystem Risk**: Low. Self-contained, but it forfeits the regression contract the rest of the system needs.

## Decision

Adopt **Option 1**: the L&S break surface is quarantined in one versioned `ls-protocol` module, driven by `protocol.config.<v>.json`, behind a narrow `ProtocolModule` interface, selected by an active version.

The implementation will use:
- **A `ProtocolModule` interface** exposing handshake assembly, `decode(frame, config) → Tick`, and ISIN→internal-id mapping — the only seam the rest of the feed-engine sees.
- **`protocol.config.<v>.json`** holding every Appendix A break-surface value: `LS_cid`, adapter set (`WALLSTREETONLINE`), required subprotocol/origin, fixed frame bytes, line ending (`\r\n`), byte offsets and id-remap rules.
- **A pure decode function** with no sockets/timers/RTDB writes, so it is offline-replayable against the fixture corpus.
- **Three editable modules + config + fixtures** as the *entire* surface a self-heal PR (ADR-0010) may touch; the socket lifecycle, RTDB fan-out (ADR-0005) and health/sanity code are off-limits and import only the interface and emitted `Tick`s (ADR-0006).
- **An active-version pointer** so a merged protocol fix rolls forward/back as data rather than as a feed-engine code deploy.

## Consequences

### Positive

1. **Bounded, reviewable self-heal**: a protocol break maps to a small diff — often a single `protocol.config.<v>.json` bump — exactly matching §D's "bounded break surface" requirement and keeping ADR-0010's PRs human-reviewable.
2. **Clean deterministic regression**: the pure `decode` function plus versioned fixtures gives CI an offline, no-auto-merge gate with an objective pass/fail, as §D demands.
3. **Versioned audit trail**: the config-plus-fixtures corpus is self-documenting protocol-by-example and the regression base in one artefact (brief §3 auditability).
4. **Topology preserved**: the module is a pure sub-unit of the single-process feed-engine, so the in-memory L&S-vs-Yahoo sanity oracle (ADR-0002/0003) is untouched.
5. **Secret/internal containment**: source internals stay behind one server-side boundary; only `Tick`s cross `data-contracts` (ADR-0006), honouring brief §3.

### Negative

1. **Schema-expressiveness ceiling**: a genuinely novel protocol mutation may exceed what `protocol.config.<v>.json` can express, forcing a codec *code* change — and because the interface/schema is hard to reverse, widening it ripples into the fixture corpus and CI harness.
2. **Up-front cost gating ADR-0010**: the interface, config schema and replay harness must be designed before self-heal automation can be built, front-loading effort that inline code would defer.
3. **Indirection over legibility**: "what the protocol does" is split between config and codec, which is less immediately readable than protocol literals sitting next to the socket.
4. **Schema is now a maintained contract**: the config schema itself can have bugs, needs validation, and becomes another versioned thing the team must not break.

### Neutral

1. **Active-version swap is a deliberate operational step**: rolling a fix forward is a data change, not a deploy — convenient, but it adds a config-version lifecycle to operate.
2. **Community Python reimpl stays a reference**: it informs the config and fixtures but carries no runtime weight (contrast Option 3).
3. **ISIN remap lives inside the module**: per-source mapping is intentionally hidden from the rest of cancri, consistent with ADR-0007.

## Decision Outcome

The objectives are met by making the break surface *data*: Appendix A's enumerated flip-points become values in a versioned config consumed by pure codecs behind a narrow interface. This directly satisfies the brief's hardest maintenance requirement — a bounded self-heal target with a deterministic, offline, no-auto-merge regression — while preserving the single-process feed-engine topology the sanity oracle depends on and keeping source internals server-side.

Mitigations:
- **Schema-expressiveness ceiling**: version the config schema explicitly and treat a schema-widening as a normal (human-reviewed) code change; the `decode` function remains the escape hatch when config cannot express a mutation, and the fixture corpus pins the new shape immediately.
- **Up-front cost**: design the `ProtocolModule` interface and config schema first as the contract ADR-0010, the CI replay harness and the fixture corpus all share, so the investment is amortised across the self-heal loop rather than duplicated.
- **Indirection/legibility**: keep the active `protocol.config.<v>.json` and its fixtures co-located and documented as the canonical "what the protocol is right now," so the config *is* the readable spec.
- **Schema-as-contract**: validate config against its schema in CI and replay the fixture corpus on every change, so a malformed or behaviour-changing config fails fast before it can reach the always-on feed-engine.

## Related Decisions

- [ADR-0002: Runtime Classes Topology](0002-three-runtime-classes-execution-model.md) - Functions cannot hold sockets; the L&S tap (and thus this module) lives in the always-on feed-engine.
- [ADR-0003: Feed-Engine Service](0003-feed-engine-single-process-singleton.md) - Hosts this module in-process beside the Yahoo tap so the sanity oracle compares in-memory.
- [ADR-0005: RTDB as the Tick Transport](0005-realtime-transport-rtdb-tick-bus.md) - The fan-out layer that consumes this module's `Tick`s and must never import decode internals.
- [ADR-0006: Shared Tick / data-contracts Seam](0006-tick-schema-and-source-adapter-contract.md) - Defines the `Tick`/`SourceAdapter` boundary the module emits across; nothing source-specific crosses it.
- [ADR-0007: ISIN as Canonical Identity](0007-isin-resolution-llm-proposes-resolver-disposes.md) - The per-source ISIN→internal-id remapping is owned inside this module.
- [ADR-0010: Self-Heal Mechanism](0010-self-heal-governance-pr-deterministic-gate.md) - The capture-and-diff + offline-replay loop whose entire edit surface is this module's three sub-modules + config + fixtures.

## Links

- cancri Implementation Brief — `design/IMPLEMENTATION_BRIEF.md` §C (live data layer), §D (self-healing maintenance), §3 (governance/auditability).
- cancri Implementation Brief, Appendix A — Known facts about primary source L&S (the enumerated break surface: handshake params, frame offsets/line ending, id remapping).
- cancri Implementation Brief, Appendix B — Known facts about fallback Yahoo (runtime sanity oracle; does not verify the fix).

## More Information

- **Date:** 2026-06-27
- **Source:** cancri decomposition pass; IMPLEMENTATION_BRIEF.md §C/§D/§3 and Appendix A.
- **Related ADRs:** 0002, 0003, 0005, 0006, 0007, 0010.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created, awaiting implementation.

**Action Required:** Implement decision and audit.
