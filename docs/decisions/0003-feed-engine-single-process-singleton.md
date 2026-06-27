---
title: "One Feed-Engine Process Owns Both Sources"
description: "L&S and Yahoo run as two SourceAdapters behind one FeedManager in a single Cloud Run service pinned to a singleton with no HA initially."
type: adr
category: architecture
tags: [feed-engine, cloud-run, singleton, source-adapter]
status: accepted
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [cloud-run, lightstreamer, websocket, realtime-database]
---

# ADR-0003: One Feed-Engine Process Owns Both Sources; Singleton, No HA Initially

## Status

Accepted

## Context

### Background and Problem Statement

cancri's live price layer (brief §C) must tap two upstream feeds with opposite properties: **L&S** over the undocumented ls-tc.de Lightstreamer 6 push for truly live, cent-accurate ticks (Appendix A), and **Yahoo** over its public protobuf WebSocket for delayed quotes that double as the runtime sanity oracle and degradation fallback (Appendix B, §D). The platform is Firebase-only, and a foundational constraint already recorded in ADR-0002 is that Cloud Functions are request-scoped and cannot hold a long-lived socket. Therefore the persistent taps must live in an always-on Cloud Run service.

The hard problem this ADR resolves is **process topology**: how many processes hold the taps, and how the two sources relate to each other inside the runtime. The sanity oracle (§D) must compare the L&S price against the independent Yahoo reference *at the same instant*. If the two sources live in different processes, that comparison needs either a cross-service network hop or a shared store on the hot path, both of which add latency and a failure mode to a comparison that must be cheap and instantaneous. Separately, the L&S upstream is a single fragile session per the bounded break surface in Appendix A; tapping it more than once multiplies both duplicate writes onto the RTDB tick bus (ADR-0002 / ADR-0005) and the exposure to the very protocol that the self-heal machinery (ADR-0010) exists to repair.

This decision is **hard to reverse** because it pins the deployment shape (max-instances=1, concurrency=1, min-instances=1), the sole-writer invariant on `/quotes/{isin}` and `/feed/status`, and the in-memory co-location contract that the oracle and the `FeedManager` are built against. Adapters, RTDB rules, the self-heal probe, and the capture-and-diff Job all assume exactly one writer and one in-process comparison point. Unwinding that later means re-introducing write coordination, distributed locking, or an external oracle bus across several subsystems at once — not a local refactor.

### Current Limitations

1. A request-scoped Function cannot hold the L&S Lightstreamer socket or the Yahoo WS open across requests, so the taps cannot live in the Functions runtime at all (ADR-0002).
2. L&S exposes only the latest tick with no history (Appendix A); there is no replay to reconcile divergent state if two independent tappers disagree, so duplicate tapping cannot be made safe after the fact.
3. The oracle's correctness depends on comparing L&S and Yahoo for the same ISIN at the same moment; any topology that separates them introduces a hop or a shared-store read on the comparison path.
4. The RTDB tick bus is an overwrite-in-place store keyed by ISIN; multiple writers racing on the same node produce last-writer-wins corruption with no audit trail on the wire.

## Decision Drivers

### Primary Decision Drivers

1. **In-memory oracle comparison**: The sanity check (§D) must hold both the latest L&S price and the latest Yahoo reference for an ISIN in the same address space and compare them with zero cross-process latency; this is the single strongest force and it pushes both sources into one process.
2. **Single upstream L&S session, tapped once**: Appendix A describes one fragile, undocumented session. Tapping it exactly once is required to avoid duplicate RTDB writes and to keep the break surface (handshake, frame offsets, id-mapping) exposed in exactly one place that the self-heal PR (ADR-0010) is allowed to touch.
3. **Sole-writer invariant on the tick bus**: ADR-0002 / ADR-0005 make the feed-engine the only writer of `/quotes/{isin}` and `/feed/status`. A singleton trivially guarantees this; any horizontally scaled tap breaks it.
4. **No-sockets-in-Functions truth**: Persistent upstream sockets force an always-on runtime; Cloud Run with min-instances=1 is the smallest Firebase-compatible home for them (ADR-0002).

### Secondary Decision Drivers

1. **Operational simplicity for a read-only terminal**: cancri is read-only (brief §4); a brief reconnect window on restart is acceptable to the dashboard, which stays warm on last quotes, so HA is not worth its coordination cost on day one.
2. **Cost containment**: One min-instances=1 container is the floor for an always-on tap; running a redundant standby or one container per source multiplies the always-on bill for no functional gain initially.
3. **Server-side secret and origin handling**: L&S connection sensitivities (required origin, subprotocol, `LS_cid`) and all source logic must stay server-side (brief §3); concentrating them in one service keeps that surface minimal.
4. **Reversibility toward HA, not away from it**: If availability later matters, the cheaper evolution is to add leader election in front of the existing singleton rather than to shard the tap — so the design should keep that door open.

## Considered Options

### Option 1: Single co-located singleton process, sole tick writer

**Description**: One Cloud Run service (`feed-engine`) runs both an L&S `SourceAdapter` and a Yahoo `SourceAdapter` behind one `FeedManager`. It is pinned to `max-instances=1`, `concurrency=1`, `min-instances=1`. It is the only writer of normalised ticks to `/quotes/{isin}` and of `/feed/status` via the Admin SDK. The oracle compares L&S vs Yahoo in-process. No HA: a restart is a few seconds of RECONNECT.

**Technical Characteristics**:
- Two adapters implementing the shared `SourceAdapter` contract (ADR-0006), each owning its own ISIN→symbol/venue mapping (ADR-0007).
- One `FeedManager` orchestrates degradation (L&S → Yahoo), holds the latest-tick map per source in memory, and runs the sanity oracle synchronously on tick.
- Singleton enforced by deployment flags; sole-writer invariant enforced by topology, not by a lock.
- Restart behaviour: container recycle → both sockets re-handshake → clients stay warm on last RTDB values and see `freshness`/status transition to reconnect (ADR-0005).

**Advantages**:
- Oracle comparison is a local memory read — zero hop, zero shared-store dependency, exactly what §D needs.
- Exactly one L&S session and one writer: no duplicate writes, no write coordination, minimal break-surface exposure.
- Smallest always-on footprint and simplest operational model for a read-only terminal.
- Co-location matches the cross-cutting mandate (decision #1) and keeps the self-heal target (ADR-0010) in one process.

**Disadvantages**:
- No high availability: a crash or deploy is a visible reconnect gap (seconds) during which no fresh ticks are written.
- The single container is a hard throughput and connection ceiling; vertical scaling only.
- Concentrates two failure domains (both upstreams) in one process — a process-level fault stalls both live and fallback simultaneously.

**Risk Assessment**:
- **Technical Risk**: Medium. Co-location is simple, but the singleton is a single point of failure and the topology is hard to reverse once subsystems assume one writer.
- **Schedule Risk**: Low. Fewest moving parts; no distributed coordination to build before first light.
- **Ecosystem Risk**: Low. Standard Cloud Run min-instances=1 deployment well within Firebase platform support.

### Option 2: Separate Cloud Run service per source

**Description**: An L&S service and a Yahoo service each run independently, each tapping its own upstream. The sanity oracle runs as a third party that reads both, either via an inter-service request or against a shared store both services write.

**Technical Characteristics**:
- Two always-on containers, each with its own lifecycle, scaling, and deploy.
- Oracle needs a transport: synchronous service-to-service call per comparison, or a shared cache/RTDB read both services populate.
- Two writers onto the tick bus unless an explicit ownership split is enforced per ISIN.

**Advantages**:
- Clean failure isolation: an L&S crash does not take down the Yahoo tap, and vice versa.
- Independent scaling and deploy cadence per source.
- Smaller break surface per container (each holds one protocol).

**Disadvantages**:
- The oracle's same-instant comparison now crosses a network hop or a shared store, adding latency and a new failure mode to the one comparison that must be cheap — directly violates the §D in-memory requirement and cross-cutting decision #1.
- Two always-on containers double the floor cost for no functional gain.
- Coordinating sole-writership across two services re-introduces exactly the write-arbitration the singleton avoids.

**Risk Assessment**:
- **Technical Risk**: High. The cross-service oracle path is the system's most latency-sensitive operation and now its most fragile.
- **Schedule Risk**: Medium. Requires building and testing an inter-service or shared-store oracle transport before the sanity check works at all.
- **Ecosystem Risk**: Low. Two Cloud Run services is a fully supported pattern.

### Option 3: Scale the tap horizontally

**Description**: Run multiple feed-engine instances (concurrency/max-instances > 1), each opening its own L&S and Yahoo session, for availability and throughput headroom.

**Technical Characteristics**:
- N containers, each with a duplicate L&S session and a duplicate Yahoo session.
- N writers racing to overwrite `/quotes/{isin}`; last-writer-wins on every node.
- N copies of the fragile L&S handshake live against the same undocumented upstream.

**Advantages**:
- Survives a single-instance crash without a global reconnect gap.
- Throughput headroom beyond one container.

**Disadvantages**:
- Duplicate L&S sessions multiply exposure to the break surface (Appendix A) — the opposite of what the self-heal design wants — and risk upstream rate-limiting or session collision on an undocumented service.
- Duplicate writes corrupt the overwrite-in-place tick bus and break the sole-writer invariant (ADR-0005); with no L&S history (Appendix A) divergent writers cannot be reconciled.
- Each node's oracle sees only its own sockets, so "which price is canonical" becomes ambiguous across nodes.

**Risk Assessment**:
- **Technical Risk**: High. Duplicate writes and multiplied protocol exposure attack the two invariants the system most depends on.
- **Schedule Risk**: Medium. Needs write-ownership sharding and dedup logic that does not otherwise exist.
- **Ecosystem Risk**: Medium. Multiple concurrent sessions against an undocumented, deprecated upstream invites blocking or instability.

### Option 4: Leader-elected HA pair via an RTDB lock

**Description**: Two feed-engine instances run; both can tap, but an RTDB-based lease elects one **leader** that alone writes ticks. The standby holds warm sockets and takes over on lease expiry.

**Technical Characteristics**:
- RTDB lease node acts as the distributed lock; leader renews it, standby watches for expiry.
- Only the leader writes `/quotes/{isin}` and `/feed/status`; the follower is hot standby.
- Failover is bounded by lease TTL plus takeover handshake.

**Advantages**:
- Preserves the sole-writer invariant (one leader writes) while gaining sub-restart failover.
- Materially shorter unavailability than a cold singleton restart.
- Keeps oracle in-process on whichever node is leader.

**Disadvantages**:
- Distributed leader election is notoriously subtle (split-brain, lease clock skew, double-write during failover) — significant complexity for a read-only terminal whose restart gap is already only seconds.
- The standby still holds a second L&S session warm, partially re-incurring the duplicate-session exposure of Appendix A.
- Premature: it solves an availability problem cancri does not yet have, and it is the documented *later* evolution path, not the day-one shape.

**Risk Assessment**:
- **Technical Risk**: Medium. Correct leader election and clean failover are hard to get right and to test against an undocumented upstream.
- **Schedule Risk**: High. Builds and hardens a distributed-coordination subsystem before first light for marginal day-one value.
- **Ecosystem Risk**: Low. RTDB-based leasing is a known pattern within Firebase.

## Decision

Adopt **Option 1**: L&S and Yahoo run as two `SourceAdapter` implementations behind one `FeedManager` inside a single Cloud Run service, `feed-engine`, pinned to `max-instances=1`, `concurrency=1`, `min-instances=1`. This process is the sole writer of normalised ticks to `/quotes/{isin}` (overwrite-in-place) and of the global `/feed/status`, via the Admin SDK. There is no high availability initially; a restart is an accepted few-second RECONNECT window during which clients stay warm on last RTDB quotes.

The implementation will use:
- **One Cloud Run service `feed-engine`** (min/max/concurrency = 1) as the always-on home for both persistent upstream sockets.
- **Two `SourceAdapter` instances** (L&S primary, Yahoo fallback) conforming to the shared contract (ADR-0006), each owning its per-source ISIN→symbol/venue mapping (ADR-0007).
- **One `FeedManager`** holding the latest-tick map per source in memory, driving L&S→Yahoo degradation, and running the sanity oracle as a synchronous in-process comparison on every tick.
- **The RTDB Admin SDK** as the only write path to `/quotes/{isin}` and `/feed/status` (ADR-0005), with sole-writership guaranteed by the singleton topology rather than by a lock.
- **A documented evolution path to Option 4** (leader election) reserved for if and when availability requirements arrive — explicitly not built now.

## Consequences

### Positive

1. **Oracle is a local read**: L&S and Yahoo latest prices live in the same address space, so the §D sanity comparison is a zero-hop memory operation with no shared-store dependency on the hot path.
2. **Invariants hold by construction**: One L&S session and one writer mean no duplicate ticks, no write arbitration, and the break surface is exposed in exactly one place for the self-heal PR (ADR-0010) to touch.
3. **Smallest, simplest footprint**: A single min-instances=1 container is the cheapest viable always-on tap and the least operationally complex shape for a read-only terminal.
4. **Clean evolution story**: Adding leader election later is an additive change in front of the existing singleton, not a re-architecture of the tap.

### Negative

1. **Single point of failure with no HA**: A crash or deploy produces a visible reconnect gap (seconds) during which no fresh ticks are written; the dashboard goes "delayed/reconnect", not dark, but it is genuinely stale for that window.
2. **Coupled failure domains**: Both upstreams live in one process, so a process-level fault (OOM, bad deploy, runtime panic) stalls the live source *and* the fallback at once, defeating the purpose of having a fallback for that class of failure.
3. **Hard throughput/connection ceiling**: concurrency=1, max-instances=1 means only vertical scaling; if the inventory of subscribed ISINs grows beyond what one container can tap and normalise, the only lever is a bigger machine.
4. **Hard to reverse**: The sole-writer and in-memory-oracle assumptions are baked into adapters, RTDB rules, the self-heal probe, and the capture-and-diff Job; changing topology later touches all of them together.

### Neutral

1. **HA deferred, not denied**: The leader-election path (Option 4) is documented and reachable; the decision is timing, not direction.
2. **Vertical-scale headroom assumed sufficient**: For the brief's read-only, per-user portfolio scope, one container is expected to cover the working ISIN set; this is a watch-item, not a present constraint.
3. **Both adapters share one lifecycle**: They deploy, restart, and version together — simpler to reason about, but it removes the option of an independent per-source deploy cadence.

## Decision Outcome

The objectives are met: the singleton co-locates L&S and Yahoo so the sanity oracle compares them in memory (§D, decision #1); it taps the fragile L&S upstream exactly once and writes the tick bus as the sole writer (decisions #2, #3, ADR-0005); and it lives in the only Firebase-compatible always-on runtime for persistent sockets (ADR-0002). The read-only nature of cancri makes the absence of HA an acceptable day-one trade, and the design keeps the cheaper HA evolution (leader election) open rather than the expensive one (sharding the tap).

Mitigations:
- **Restart gap**: `min-instances=1` keeps a container always warm so restarts are recycles, not cold starts; clients stay on last RTDB quotes and surface `reconnect`/`delayed` per ADR-0005 rather than going dark.
- **Coupled failure domains**: the in-process self-heal probe plus a Cloud Scheduler `/healthz` watchdog (ADR-0010) detect a stalled process quickly and force a restart, bounding the outage.
- **Throughput ceiling**: monitor per-container tick/ISIN load via `/feed/status`; the documented escape hatch is to raise the container size first and adopt leader-elected HA (Option 4) only if availability becomes a requirement.
- **Hard reversibility**: the `SourceAdapter`/`FeedManager` seam (ADR-0006) localises source logic so a future topology change re-wires orchestration without rewriting adapter internals.

## Related Decisions

- [ADR-0002: Runtime Classes Topology](0002-three-runtime-classes-execution-model.md) - establishes that Functions cannot hold sockets and that an always-on Cloud Run service is required; this ADR fixes that service's internal shape.
- [ADR-0005: RTDB Tick Transport](0005-realtime-transport-rtdb-tick-bus.md) - defines the `/quotes/{isin}` and `/feed/status` write target and the sole-writer invariant this singleton guarantees.
- [ADR-0006: Tick and SourceAdapter Contract](0006-tick-schema-and-source-adapter-contract.md) - the shared seam both adapters implement behind the `FeedManager`.
- [ADR-0007: ISIN as Canonical Key](0007-isin-resolution-llm-proposes-resolver-disposes.md) - the join key the oracle uses to align L&S and Yahoo prices in memory; per-source mapping lives inside each adapter.
- [ADR-0009: L&S Protocol Module](0009-ls-protocol-break-surface-isolation.md) - the quarantined break surface tapped by the single L&S adapter in this process.
- [ADR-0010: Self-Heal Pipeline](0010-self-heal-governance-pr-deterministic-gate.md) - the in-process probe, `/healthz` watchdog, and capture-and-diff Job that mitigate this singleton's failure modes.

## Links

- [cancri Implementation Brief](../../design/IMPLEMENTATION_BRIEF.md) - §C live price data layer, §D self-healing, §3 governance/security, §4 read-only non-goals.
- [Implementation Brief Appendix A — L&S](../../design/IMPLEMENTATION_BRIEF.md) - undocumented Lightstreamer 6 push, single fragile session, bounded break surface, no history.
- [Implementation Brief Appendix B — Yahoo](../../design/IMPLEMENTATION_BRIEF.md) - public protobuf WebSocket, delayed German venues, fallback and sanity-oracle role.

## More Information

- **Date:** 2026-06-27
- **Source:** cancri architecture decomposition pass; shared cross-cutting decision #1 (one co-located always-on feed-engine).
- **Related ADRs:** ADR-0002, ADR-0005, ADR-0006, ADR-0007, ADR-0009, ADR-0010.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created, awaiting implementation.

**Action Required:** Implement decision and audit.
