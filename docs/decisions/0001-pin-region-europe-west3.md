---
title: "Pin All Resources to europe-west3 (Frankfurt)"
description: "Create Firestore, RTDB, Cloud Run, Functions, Storage and the Job exclusively in europe-west3 to co-locate with German venues and keep EU residency."
type: adr
category: infrastructure
tags: [region, data-residency, latency, irreversible]
status: accepted
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [firebase, google-cloud, firestore, realtime-database, cloud-run, cloud-functions, cloud-storage]
---

# ADR-0001: Pin All Resources to europe-west3 (Frankfurt)

## Status

Accepted

## Context

### Background and Problem Statement

cancri is a Firebase-hosted, access-gated live-portfolio terminal for German equities. Its live data layer dials two upstreams that physically live in Germany: the L&S push via `ls-tc.de` (Appendix A) and Yahoo's public WebSocket reading German venues such as `.DE` (Xetra), `.HM` (Hamburg) and `.F` (Frankfurt) (Appendix B). The always-on feed-engine (Cloud Run) holds both sockets and writes normalised ticks into RTDB; clients subscribe to RTDB directly; the per-user book lives in Firestore; Functions handle Gemini, logo and instrument-search; an on-demand Cloud Run Job runs the Playwright capture-and-diff.

Every one of these resources must be created in a Google Cloud location, and that choice is made **per resource at creation time**. The hardest constraint is that a **Firestore database's location is PERMANENT** — it cannot be moved after creation; changing it means deleting and recreating the database (and the project's default GCP resource location, which Firestore and Storage inherit, is itself sticky). RTDB instances and a Storage default bucket are likewise bound to a location at creation. This makes the region choice genuinely irreversible for the durable stores, and it is logically **first**: every subsequent provisioning step (datastore creation in ADR-0004, feed-engine deployment in ADR-0003) inherits or must agree with this decision. Getting it wrong means tearing down state, not editing config.

Two forces pull on the choice. First, **latency**: the feed-engine's value proposition is cent-accurate, truly-live ticks, and the sanity oracle compares L&S vs Yahoo in-memory — both depend on minimising socket RTT to Frankfurt-adjacent endpoints. Second, **EU data residency**: holdings are private per-user financial data under uid-scoped Firestore rules, and keeping all storage and compute in Germany keeps the residency story clean and auditable.

### Current Limitations

1. No resources exist yet; the project has no pinned region, so any datastore created without an explicit, signed-off decision risks landing in a default (typically US) location that is then permanent.
2. The brief fixes the platform as Firebase but leaves "Data stays inside the Firebase project" as the only locality constraint — region is unspecified and must be decided before provisioning.
3. Cross-region latency between compute and the German upstreams, or between the feed-engine and the stores it writes, would directly degrade the live-tick experience that is the product's core.
4. A wrong durable-store region cannot be corrected in place; it forces a destroy-and-recreate migration once user books and audit history exist.

## Decision Drivers

### Primary Decision Drivers

1. **Irreversibility of the datastore location**: Firestore location is permanent and RTDB/Storage are location-bound at creation, so this must be signed off before any datastore exists. This alone justifies recording the decision first and explicitly.
2. **Proximity to German upstreams**: L&S (`ls-tc.de`) and the German Yahoo venues are physically in/near Frankfurt; co-locating compute cuts socket RTT for the L&S Lightstreamer tap and the Yahoo WS, tightening the in-memory sanity-oracle comparison.
3. **EU data residency for private financial data**: per-user holdings, drafts and audit are private (uid-scoped Firestore); keeping all storage and compute in a German region keeps residency clean and defensible.
4. **Provisioning order dependency**: every other foundational decision (runtime classes, feed-engine, datastore split, transport) inherits this region, so it must be settled at the root of the dependency graph.

### Secondary Decision Drivers

1. **Co-location of the tick path**: the feed-engine (Cloud Run, sole RTDB writer) and RTDB should sit in the same region to minimise write latency on the `/quotes/{isin}` hot path that fans out to clients.
2. **Single-region operational simplicity**: one region for Firestore, RTDB, Cloud Run, Functions, Storage and the Job is simpler to reason about, secure and audit than a mixed-region topology, consistent with the "smallest topology that satisfies the brief" stance.
3. **Service availability in europe-west3**: all required Firebase/GCP products (Firestore, RTDB, Cloud Run, 2nd-gen Functions, Storage, Cloud Run Jobs, Vertex AI for Gemini) are offered in europe-west3, so no service forces an exception.
4. **Firebase-only, server-side-secrets posture**: the brief mandates Firebase hosting with all source logic and secrets server-side; a single pinned region keeps that server-side surface contained and uniformly governed.

## Considered Options

### Option 1: europe-west3 (Frankfurt) single region

**Description**: Create Firestore, RTDB, Cloud Run (feed-engine), Functions, Cloud Storage and the Cloud Run Job all in `europe-west3`, and set the project's default GCP resource location to Frankfurt so inherited resources follow.

**Technical Characteristics**:
- Single regional Firestore database in `europe-west3`; RTDB instance and default Storage bucket in the same region.
- feed-engine, Functions and the capture-and-diff Job deployed to `europe-west3`, co-located with RTDB and with the German upstreams.
- Vertex AI (Gemini) called from a `europe-west3` Function via service-account IAM.
- One region to configure, monitor and bill; no inter-region egress on the tick path.

**Advantages**:
- Lowest socket RTT to `ls-tc.de` and German Yahoo venues, directly serving the live-tick objective and the in-memory sanity oracle.
- Cleanest EU/German data-residency story for private holdings, drafts and audit.
- Single-region simplicity: uniform governance, no cross-region egress, easy to audit.
- feed-engine and RTDB co-located, minimising hot-path write latency.

**Disadvantages**:
- Single-region: no multi-region durability for Firestore; a regional outage takes the whole stack down (acceptable for a read-only display, but real).
- Frankfurt regional pricing is modestly higher than the `us-central1` default for some SKUs.
- Permanent commitment for the datastores — if German venues or residency assumptions ever changed materially, correction requires destroy-and-recreate.

**Risk Assessment**:
- **Technical Risk**: Low. All required services are available in europe-west3 and co-location reduces, not adds, moving parts.
- **Schedule Risk**: Low. A region choice made up front costs nothing to implement; the risk is entirely in *not* deciding before provisioning.
- **Ecosystem Risk**: Low. europe-west3 is a long-standing, fully featured GCP region with first-class Firebase support.

### Option 2: europe-west1 / EU multi-region

**Description**: Use the `eur3` EU multi-region for Firestore (and a comparable EU-spanning setup), with compute in `europe-west1` (Belgium), trading single-region latency for higher Firestore durability.

**Technical Characteristics**:
- Firestore in the `eur3` multi-region (data replicated across multiple EU regions); compute in `europe-west1`.
- Higher write latency and cost on Firestore relative to a single nearby region.
- Compute one region removed (Belgium) from the German upstreams.

**Advantages**:
- Stronger durability/availability for the durable book via multi-region replication.
- Still EU-resident, satisfying the residency driver.
- europe-west1 is mature and well-provisioned.

**Disadvantages**:
- Compute in Belgium adds RTT to the Frankfurt-based upstreams, blunting the live-tick and sanity-oracle edge.
- Multi-region Firestore is costlier and has higher write latency — overkill for a read-only terminal whose durable writes are low-frequency (inventory/drafts/audit), not the hot path.
- Splits "near the data" (compute) from "broadly EU" (storage), complicating the single-region simplicity goal.

**Risk Assessment**:
- **Technical Risk**: Medium. Mixing a multi-region store with single-region compute adds latency asymmetry and cross-zone considerations on the tick path.
- **Schedule Risk**: Low. Provisionable up front like Option 1.
- **Ecosystem Risk**: Low. Both `eur3` and europe-west1 are fully supported.

### Option 3: us-central1 default

**Description**: Accept Google Cloud's common default region `us-central1` (Iowa) for all resources, minimising configuration friction and cost.

**Technical Characteristics**:
- Firestore, RTDB, Cloud Run, Functions, Storage and the Job all in `us-central1`.
- Transatlantic RTT (~100ms+) between compute and the German upstreams and back to EU clients.
- Lowest-cost regional SKUs for several products.

**Advantages**:
- Cheapest for several SKUs; broadest service availability and newest-feature rollout.
- Zero region-selection friction — it is the implicit default for many GCP/Firebase flows.

**Disadvantages**:
- Transatlantic latency to `ls-tc.de` and German Yahoo venues materially degrades the live-tick experience and slows the sanity-oracle loop.
- **Fails EU data residency** for private German financial data — a likely compliance and trust problem.
- Worse client-perceived latency for EU users subscribing to RTDB.

**Risk Assessment**:
- **Technical Risk**: Medium. The architecture would still function, but the core latency-sensitive feature is structurally handicapped.
- **Schedule Risk**: Low. It is the path of least configuration effort.
- **Ecosystem Risk**: High. Storing EU users' private holdings in the US undermines the residency posture and is hard to walk back given the permanent datastore location.

### Option 4: Per-service mixed regions

**Description**: Pick the locally optimal region per service — e.g. compute in `europe-west3` next to the upstreams, but datastores or Functions wherever cheapest/most available.

**Technical Characteristics**:
- feed-engine in europe-west3; Firestore/RTDB/Storage/Functions potentially in different regions.
- Cross-region hops between compute and stores; mixed residency footprint.
- Multiple regional configs, IAM scopes and monitoring surfaces.

**Advantages**:
- Each service can sit in its individually cheapest or most feature-complete region.
- Lets compute stay near the upstreams even if a store is placed elsewhere.

**Disadvantages**:
- Cross-region latency between the feed-engine and RTDB on the hot write path, undermining the very co-location the architecture relies on.
- Fragmented residency story — private data could straddle regions, the opposite of the clean EU boundary wanted.
- Highest operational and audit complexity; every permanent datastore location becomes an independent irreversible commitment to track.

**Risk Assessment**:
- **Technical Risk**: High. Cross-region hops on the tick path and a multi-region IAM/network surface add latency and failure modes.
- **Schedule Risk**: Medium. More regions to configure, validate and keep consistent before anything else can be provisioned.
- **Ecosystem Risk**: Medium. Several independent permanent location commitments multiply the irreversibility surface.

## Decision

Adopt **Option 1: europe-west3 (Frankfurt) single region**. Firestore, RTDB, Cloud Run (feed-engine), Cloud Functions, Cloud Storage and the on-demand Cloud Run Job are all created in `europe-west3`, and the project's default GCP resource location is set to Frankfurt so inherited resources follow. This decision is made and signed off **before any datastore is created**, because the Firestore location is permanent.

The implementation will use:
- **Firestore (regional, europe-west3)** for the durable per-user book (inventory, drafts, append-only audit, instrument map, logo meta).
- **Realtime Database (europe-west3)** as the tick bus, co-located with the feed-engine for minimal hot-path write latency.
- **Cloud Run feed-engine (europe-west3, min/max-instances=1, concurrency=1)** holding the L&S and Yahoo sockets next to the German upstreams.
- **Cloud Functions (europe-west3)** for Gemini (Vertex AI via service-account IAM), logo, and ISIN instrument-search.
- **Cloud Storage (europe-west3)** for the logo cache and assets.
- **Cloud Run Job (europe-west3)** for the Playwright capture-and-diff.

## Consequences

### Positive

1. **Lowest upstream RTT**: compute sits next to `ls-tc.de` and the German Yahoo venues, directly serving truly-live ticks and a tight in-memory sanity oracle.
2. **Clean EU residency**: all private financial data and compute stay in Germany, giving an auditable, defensible residency boundary.
3. **Co-located tick path**: feed-engine and RTDB share a region, minimising `/quotes/{isin}` write latency before client fan-out.
4. **Root decision unblocked**: every downstream provisioning step (ADR-0003, ADR-0004, ADR-0005) inherits a single, agreed region.

### Negative

1. **Single-region fragility**: no multi-region Firestore durability; a europe-west3 regional outage takes the whole read-only stack offline until recovery.
2. **Permanent, irreversible store location**: correcting the region later means destroying and recreating Firestore/RTDB/Storage and migrating user books and audit history — there is no in-place move.
3. **Higher SKU cost than the US default**: Frankfurt regional pricing is modestly above `us-central1` for some products.

### Neutral

1. **Region pinned in IaC/config**: region becomes an explicit, reviewed parameter in every resource definition rather than an implicit default.
2. **Vertex AI region alignment**: Gemini calls target europe-west3 (or the nearest model-available EU region), keeping the LLM path EU-aligned.
3. **No multi-region ambition**: the architecture intentionally forgoes geo-distribution, consistent with a single-market German-equities product.

## Decision Outcome

The objectives are met: pinning to europe-west3 minimises socket RTT to the German upstreams (live-tick and sanity-oracle drivers), keeps all private data EU-resident, co-locates the feed-engine with RTDB on the hot path, and resolves the root provisioning dependency so the datastore and runtime ADRs can proceed against a single agreed region. The decision is recorded and signed off before any datastore exists, which is the only point at which the permanent Firestore location can still be chosen freely.

Mitigations:
- **Against single-region fragility**: the product is read-only and degrades visibly (delayed banner, reconnect states) rather than corrupting data; a regional outage is a visible availability event, not a data-integrity one. Document the recovery posture; revisit multi-region only if availability requirements harden.
- **Against irreversibility**: treat this ADR as a hard gate — datastores are created only after sign-off, and the region is asserted as an explicit, CI-checkable parameter in IaC so no resource lands in a default location by accident.
- **Against cost**: single-region Frankfurt avoids cross-region egress, offsetting higher per-SKU pricing; the durable write volume (inventory/drafts/audit) is low, so Firestore cost impact is small.

## Related Decisions

- [ADR-0002: Runtime Classes](0002-three-runtime-classes-execution-model.md) - The Functions/Cloud Run/Job runtime classes are all deployed into this region.
- [ADR-0003: Feed-Engine Service](0003-feed-engine-single-process-singleton.md) - The always-on feed-engine is deployed in europe-west3 to sit next to the German upstreams and RTDB.
- [ADR-0004: Datastore Split](0004-datastore-split-firestore-book-rtdb-wire.md) - Firestore and RTDB are created in this region; their permanent locations depend on this decision.
- [ADR-0005: Tick Transport](0005-realtime-transport-rtdb-tick-bus.md) - RTDB as the tick bus is co-located with the feed-engine per this region pin.

## Links

- cancri Implementation Brief — `design/IMPLEMENTATION_BRIEF.md` (Section 1 Platform; Section 3 Governance & security).
- Implementation Brief Appendix A — Known facts about primary source L&S (`ls-tc.de`, Frankfurt-based push).
- Implementation Brief Appendix B — Known facts about fallback Yahoo (German venue suffixes `.DE`, `.HM`, `.F`, etc.).

## More Information

- **Date:** 2026-06-27
- **Source:** cancri Implementation Brief and the architecture decomposition pass.
- **Related ADRs:** ADR-0002, ADR-0003, ADR-0004, ADR-0005.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created, awaiting implementation.

**Action Required:** Implement decision and audit.
