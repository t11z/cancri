---
title: "Pin All Resources to europe-west1 (Belgium)"
description: "Create Firestore, RTDB, Cloud Run, Functions, Storage, the Job and Vertex AI exclusively in europe-west1 — the nearest EU region that offers Realtime Database — to co-locate the tick path and keep EU residency."
type: adr
category: infrastructure
tags: [region, data-residency, latency, rtdb, irreversible]
status: accepted
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [firebase, google-cloud, firestore, realtime-database, cloud-run, cloud-functions, cloud-storage]
---

# ADR-0001: Pin All Resources to europe-west1 (Belgium)

## Status

Accepted

## Context

### Background and Problem Statement

cancri is a Firebase-hosted, access-gated live-portfolio terminal for German equities. Its live data layer dials two upstreams that physically live in Germany: the L&S push via `ls-tc.de` (Appendix A) and Yahoo's public WebSocket reading German venues such as `.DE` (Xetra), `.HM` (Hamburg) and `.F` (Frankfurt) (Appendix B). The always-on feed-engine (Cloud Run) holds both sockets and writes normalised ticks into RTDB; clients subscribe to RTDB directly (ADR-0005); the per-user book lives in Firestore; Functions handle Gemini, logo and instrument-search; an on-demand Cloud Run Job runs the Playwright capture-and-diff.

Every one of these resources must be created in a Google Cloud location, and that choice is made **per resource at creation time**. The hardest constraint is that a **Firestore database's location is PERMANENT** — it cannot be moved after creation; changing it means deleting and recreating the database (and the project's default GCP resource location, which Firestore and Storage inherit, is itself sticky). An **RTDB instance is likewise bound to a location at creation and that location is permanent**, as is a Storage default bucket. This makes the region choice genuinely irreversible for the durable stores, and it is logically **first**: every subsequent provisioning step (datastore creation in ADR-0004, feed-engine deployment in ADR-0003, the tick bus in ADR-0005) inherits or must agree with this decision. Getting it wrong means tearing down state, not editing config.

The decisive constraint is a **service-availability fact about the Realtime Database**: RTDB instances can be created in **only three locations — `us-central1` (Iowa), `europe-west1` (Belgium) and `asia-southeast1` (Singapore)** (source: <https://firebase.google.com/docs/database/locations>). There is **no RTDB in `europe-west3` (Frankfurt)**. Because ADR-0005 makes RTDB the load-bearing tick bus on the hot path — the feed-engine is its sole writer and every client subscribes to it — the region that hosts the rest of the stack must also be able to host RTDB, co-located to keep the `/quotes/{isin}` write latency low. The only EU location that offers RTDB is `europe-west1`. Belgium is therefore the nearest RTDB-supporting EU region to the Frankfurt-based upstreams: marginally further from `ls-tc.de` and the German Yahoo venues than Frankfurt would have been, but the only EU option once RTDB is required.

Two forces still pull on the choice within that constraint. First, **latency**: the feed-engine's value proposition is cent-accurate, truly-live ticks, and the sanity oracle compares L&S vs Yahoo in-memory — both want minimal socket RTT to Frankfurt-adjacent endpoints, and the feed-engine must sit next to the RTDB it writes. Second, **EU data residency**: holdings are private per-user financial data under uid-scoped Firestore rules, and keeping all storage and compute in the EU keeps the residency story clean and auditable. Both forces are satisfied by `europe-west1`; neither is satisfiable together with RTDB by `europe-west3`.

### Current Limitations

1. No resources exist yet; the project has no pinned region, so any datastore created without an explicit, signed-off decision risks landing in a default (typically US) location that is then permanent.
2. The brief fixes the platform as Firebase but leaves "Data stays inside the Firebase project" as the only locality constraint — region is unspecified and must be decided before provisioning.
3. **RTDB is not offered in `europe-west3`**: a region chosen for proximity alone (Frankfurt) cannot host the load-bearing tick bus, so the naïve "closest to the upstreams" choice is infeasible for the full stack.
4. Cross-region latency between compute and the German upstreams, or between the feed-engine and the RTDB it writes, would directly degrade the live-tick experience that is the product's core.
5. A wrong durable-store region cannot be corrected in place; it forces a destroy-and-recreate migration once user books and audit history exist.

## Decision Drivers

### Primary Decision Drivers

1. **RTDB availability gates the region**: RTDB exists only in `us-central1`, `europe-west1` and `asia-southeast1`. Since RTDB is the load-bearing tick bus (ADR-0005), the whole co-located stack must sit in one of those three — and the only EU member is `europe-west1`.
2. **Irreversibility of the datastore location**: Firestore location is permanent and RTDB/Storage are location-bound at creation, so this must be signed off before any datastore exists. This alone justifies recording the decision first and explicitly.
3. **EU data residency for private financial data**: per-user holdings, drafts and audit are private (uid-scoped Firestore); keeping all storage and compute in an EU region keeps residency clean and defensible.
4. **Proximity to German upstreams (within the EU/RTDB constraint)**: L&S (`ls-tc.de`) and the German Yahoo venues are physically in/near Frankfurt; among the RTDB-supporting EU regions, `europe-west1` (Belgium) is the closest, minimising socket RTT for the L&S Lightstreamer tap and the Yahoo WS and tightening the in-memory sanity-oracle comparison.
5. **Provisioning order dependency**: every other foundational decision (runtime classes, feed-engine, datastore split, transport) inherits this region, so it must be settled at the root of the dependency graph.

### Secondary Decision Drivers

1. **Co-location of the tick path**: the feed-engine (Cloud Run, sole RTDB writer) and RTDB must sit in the same region to minimise write latency on the `/quotes/{isin}` hot path that fans out to clients — which requires a region that actually offers RTDB.
2. **Single-region operational simplicity**: one region for Firestore, RTDB, Cloud Run, Functions, Storage, the Job and Vertex AI is simpler to reason about, secure and audit than a mixed-region topology, consistent with the "smallest topology that satisfies the brief" stance.
3. **Full service availability in europe-west1**: all required Firebase/GCP products — Firestore, **RTDB**, Cloud Run, 2nd-gen Functions, Storage, Cloud Run Jobs, and Vertex AI for Gemini (ADR-0008) — are offered in `europe-west1`, so no service forces an exception. (This corrects a factual error in an earlier draft of this ADR, which asserted RTDB was available in `europe-west3`; it is not.)
4. **Firebase-only, server-side-secrets posture**: the brief mandates Firebase hosting with all source logic and secrets server-side; a single pinned region keeps that server-side surface contained and uniformly governed.

## Considered Options

### Option 1: europe-west1 (Belgium) single region

**Description**: Create Firestore, RTDB, Cloud Run (feed-engine), Functions, Cloud Storage and the Cloud Run Job all in `europe-west1`, target Vertex AI in `europe-west1`, and set the project's default GCP resource location to Belgium so inherited resources follow.

**Technical Characteristics**:
- Single regional Firestore database in `europe-west1`; RTDB instance and default Storage bucket in the same region.
- feed-engine, Functions and the capture-and-diff Job deployed to `europe-west1`, co-located with RTDB and as close to the German upstreams as any RTDB-supporting EU region can be.
- Vertex AI (Gemini) called from a `europe-west1` Function via service-account IAM (ADR-0008).
- One region to configure, monitor and bill; no inter-region egress on the tick path.

**Advantages**:
- The only EU region that can host the load-bearing RTDB tick bus, so the whole stack — including RTDB — stays single-region and co-located.
- Clean EU data-residency story for private holdings, drafts and audit.
- Single-region simplicity: uniform governance, no cross-region egress, easy to audit.
- feed-engine and RTDB co-located, minimising hot-path write latency.
- Closest RTDB-supporting EU region to `ls-tc.de` and the German Yahoo venues.

**Disadvantages**:
- Marginally higher socket RTT to the Frankfurt-based upstreams than `europe-west3` (Frankfurt) would have given — Belgium, not Frankfurt — slightly blunting the live-tick and sanity-oracle edge.
- Single-region: no multi-region durability for Firestore; a regional outage takes the whole stack down (acceptable for a read-only display, but real).
- Permanent commitment for the datastores — if residency assumptions ever changed materially, correction requires destroy-and-recreate.

**Risk Assessment**:
- **Technical Risk**: Low. All required services — including RTDB — are available in europe-west1 and co-location reduces, not adds, moving parts; the only cost is a small, bounded RTT increase to the upstreams.
- **Schedule Risk**: Low. A region choice made up front costs nothing to implement; the risk is entirely in *not* deciding before provisioning.
- **Ecosystem Risk**: Low. europe-west1 is a long-standing, fully featured GCP region with first-class Firebase support and is one of only three RTDB locations.

### Option 2: europe-west3 (Frankfurt) single region

**Description**: Create Firestore, RTDB, Cloud Run (feed-engine), Functions, Cloud Storage and the Cloud Run Job all in `europe-west3`, co-located with the German upstreams, and set the project default location to Frankfurt.

**Technical Characteristics**:
- Lowest possible socket RTT to `ls-tc.de` and the German Yahoo venues, directly serving the live-tick objective and the in-memory sanity oracle.
- Compute, Firestore and Storage all available in `europe-west3`.
- Cleanest German residency footprint.

**Advantages**:
- Marginally lower upstream RTT than `europe-west1`, since Frankfurt is physically nearest the German venues.
- Strong EU/German residency story.
- Single-region simplicity for the products that *are* offered there.

**Disadvantages**:
- **RTDB is not offered in `europe-west3`.** Since RTDB is the load-bearing tick bus (ADR-0005), this region cannot host the full co-located stack at all.
- The only way to use europe-west3 would be to split RTDB into a different region (see Option 4), which breaks the very co-location this single-region option claims and adds a cross-region hop on the hot tick path.

**Risk Assessment**:
- **Technical Risk**: High (disqualifying). The hot-path datastore the architecture depends on simply does not exist in this region.
- **Schedule Risk**: Low. Provisionable up front — but the result cannot host RTDB, so it does not satisfy the requirement.
- **Ecosystem Risk**: Medium. europe-west3 is fully supported for other products, but lacking RTDB makes it unfit for this stack.

**Disqualifying Factor**: RTDB, the load-bearing tick bus, is not available in europe-west3; the original draft of this ADR chose europe-west3 on the mistaken belief that it was.

### Option 3: us-central1 (RTDB-supporting) or eur3 multi-region

**Description**: Either accept Google Cloud's common default `us-central1` (Iowa) — an RTDB-supporting region — for all resources, or place Firestore in the `eur3` EU multi-region for higher durability with compute and RTDB elsewhere.

**Technical Characteristics**:
- `us-central1` does support RTDB and offers the broadest/cheapest service availability, but is transatlantic (~100ms+) from the German upstreams and the EU clients.
- `eur3` gives multi-region Firestore durability but does not change the RTDB constraint (RTDB is single-region only and must still land in one of the three locations), and it raises Firestore write latency and cost.

**Advantages**:
- `us-central1`: RTDB-capable, cheapest for several SKUs, broadest feature rollout, zero region-selection friction.
- `eur3`: stronger Firestore durability via multi-region replication, still EU-resident.

**Disadvantages**:
- `us-central1` **fails EU data residency** for private German financial data — a likely compliance and trust problem — and adds transatlantic latency to the upstreams and to EU clients; the permanent datastore location makes this hard to walk back.
- `eur3` is overkill for a read-only terminal whose durable writes are low-frequency (inventory/drafts/audit), costlier and higher-latency, and it still leaves RTDB single-region, so it does not solve the actual gating constraint while splitting "broadly EU" storage from "one region" compute.

**Risk Assessment**:
- **Technical Risk**: Medium. Both function technically, but `us-central1` structurally handicaps the latency-sensitive core and `eur3` adds latency/cost without addressing the RTDB pin.
- **Schedule Risk**: Low. Either is provisionable up front.
- **Ecosystem Risk**: High for `us-central1` (US storage of EU users' private holdings undermines the residency posture and is permanent); Medium for `eur3` (extra cost/latency for no decisive benefit here).

### Option 4: Per-service mixed regions (e.g. RTDB in europe-west1, the rest in europe-west3)

**Description**: Pick the locally optimal region per service — for example keep compute, Firestore and Storage in `europe-west3` next to the upstreams while placing RTDB in `europe-west1` (since RTDB cannot live in Frankfurt), or otherwise spread services by cost/availability.

**Technical Characteristics**:
- feed-engine in one region; RTDB necessarily in a different region (`europe-west1`), because RTDB is unavailable in `europe-west3`.
- Cross-region hops between the feed-engine and RTDB on the hot write path; mixed residency footprint; multiple regional configs, IAM scopes and monitoring surfaces.

**Advantages**:
- Compute could sit marginally closer to the upstreams (Frankfurt) while RTDB still exists somewhere it is offered.
- Each service can nominally sit in its individually cheapest or most feature-complete region.

**Disadvantages**:
- Puts a **cross-region hop on the `/quotes/{isin}` hot path** between the feed-engine and RTDB, directly undermining the co-location the architecture relies on — the small RTT gain to the upstreams is paid back, with interest, on every tick write.
- Fragmented residency story — private data and the tick bus straddle regions, the opposite of the clean EU boundary wanted; residency uniformity is harder to assert and audit.
- Highest operational and audit complexity; every permanent datastore location becomes an independent irreversible commitment to track.

**Risk Assessment**:
- **Technical Risk**: High. A cross-region hop on the tick path and a multi-region IAM/network surface add latency and failure modes exactly where the product is most sensitive.
- **Schedule Risk**: Medium. More regions to configure, validate and keep consistent before anything else can be provisioned.
- **Ecosystem Risk**: Medium. Several independent permanent location commitments multiply the irreversibility surface and complicate the residency claim.

## Decision

Adopt **Option 1: europe-west1 (Belgium) single region**. Firestore, RTDB, Cloud Run (feed-engine), Cloud Functions, Cloud Storage and the on-demand Cloud Run Job are all created in `europe-west1`, Vertex AI (Gemini) is targeted in `europe-west1`, and the project's default GCP resource location is set to Belgium so inherited resources follow. This decision is made and signed off **before any datastore is created**, because the Firestore and RTDB locations are permanent.

`europe-west1` is chosen because it is the **only EU region that offers the Realtime Database**, which ADR-0005 makes the load-bearing tick bus; `europe-west3` (Frankfurt), although marginally closer to the German upstreams, does not offer RTDB and is therefore disqualified for a co-located single-region stack. This also resolves a latent inconsistency in the codebase: `apps/web/src/firebase.ts` already pointed the RTDB URL at `europe-west1.firebasedatabase.app`, so pinning the whole stack to `europe-west1` makes the configuration coherent.

The implementation will use:
- **Firestore (regional, europe-west1)** for the durable per-user book (inventory, drafts, append-only audit, instrument map, logo meta).
- **Realtime Database (europe-west1)** as the tick bus, co-located with the feed-engine for minimal hot-path write latency.
- **Cloud Run feed-engine (europe-west1, min/max-instances=1, concurrency=1)** holding the L&S and Yahoo sockets, as close to the German upstreams as an RTDB-supporting EU region allows.
- **Cloud Functions (europe-west1)** for Gemini (Vertex AI via service-account IAM), logo, and ISIN instrument-search.
- **Cloud Storage (europe-west1)** for the logo cache and assets.
- **Cloud Run Job (europe-west1)** for the Playwright capture-and-diff.
- **Vertex AI / Gemini (europe-west1)** for inventory normalisation (ADR-0008), keeping the LLM path EU-aligned and co-regional.

## Consequences

### Positive

1. **RTDB can actually be hosted**: pinning to europe-west1 is what allows the load-bearing tick bus to exist at all inside an EU region, co-located with everything else.
2. **Clean EU residency**: all private financial data and compute stay in the EU, giving an auditable, defensible residency boundary.
3. **Co-located tick path**: feed-engine and RTDB share a region, minimising `/quotes/{isin}` write latency before client fan-out.
4. **Config inconsistency removed**: the stack region now matches the `europe-west1.firebasedatabase.app` RTDB URL already present in `apps/web/src/firebase.ts`.
5. **Root decision unblocked**: every downstream provisioning step (ADR-0003, ADR-0004, ADR-0005, ADR-0008) inherits a single, agreed, RTDB-capable region.

### Negative

1. **Slightly higher upstream RTT than Frankfurt**: compute sits in Belgium rather than next to `ls-tc.de` and the German Yahoo venues, a small, bounded latency cost on the L&S/Yahoo taps and the sanity-oracle comparison — the unavoidable price of needing RTDB in the EU.
2. **Single-region fragility**: no multi-region Firestore durability; a europe-west1 regional outage takes the whole read-only stack offline until recovery.
3. **Permanent, irreversible store location**: correcting the region later means destroying and recreating Firestore/RTDB/Storage and migrating user books and audit history — there is no in-place move.

### Neutral

1. **Region pinned in IaC/config**: region becomes an explicit, reviewed parameter in every resource definition rather than an implicit default.
2. **Vertex AI region alignment**: Gemini calls target europe-west1 (or the nearest model-available EU region), keeping the LLM path EU-aligned.
3. **No multi-region ambition**: the architecture intentionally forgoes geo-distribution, consistent with a single-market German-equities product.

## Decision Outcome

The objectives are met: pinning to europe-west1 is the only way to keep the load-bearing RTDB tick bus inside an EU region while co-locating it with the feed-engine on the hot path; it keeps all private data EU-resident; it places compute in the nearest RTDB-supporting EU region to the German upstreams; and it resolves the root provisioning dependency so the datastore and runtime ADRs can proceed against a single agreed region. The decision is recorded and signed off before any datastore exists, which is the only point at which the permanent Firestore and RTDB locations can still be chosen freely.

Mitigations:
- **Against the marginal RTT increase vs Frankfurt**: europe-west1 is the closest RTDB-supporting EU region to the upstreams; the increase over europe-west3 is small and bounded, and the sanity oracle compares in-memory once both sockets land, so the extra hop affects ingest latency only modestly. Avoiding any cross-region hop on the RTDB write path (Option 4) preserves the dominant hot-path latency.
- **Against single-region fragility**: the product is read-only and degrades visibly (delayed banner, reconnect states) rather than corrupting data; a regional outage is a visible availability event, not a data-integrity one. Document the recovery posture; revisit multi-region only if availability requirements harden.
- **Against irreversibility**: treat this ADR as a hard gate — datastores are created only after sign-off, and the region is asserted as an explicit, CI-checkable parameter in IaC so no resource lands in a default location by accident.

## Related Decisions

- [ADR-0002: Runtime Classes](0002-three-runtime-classes-execution-model.md) - The Functions/Cloud Run/Job runtime classes are all deployed into this region.
- [ADR-0003: Feed-Engine Service](0003-feed-engine-single-process-singleton.md) - The always-on feed-engine is deployed in europe-west1, co-located with RTDB and as near the German upstreams as an RTDB-supporting EU region allows.
- [ADR-0004: Datastore Split](0004-datastore-split-firestore-book-rtdb-wire.md) - Firestore and RTDB are created in this region; their permanent locations depend on this decision.
- [ADR-0005: Tick Transport](0005-realtime-transport-rtdb-tick-bus.md) - RTDB as the tick bus is the load-bearing constraint that forces an RTDB-supporting region; it is co-located with the feed-engine per this region pin.
- [ADR-0008: Gemini via Vertex AI](0008-gemini-vertex-iam-callable.md) - Vertex AI / Gemini is targeted in this region to keep the LLM path EU-aligned and co-regional.

## Links

- [Firebase Realtime Database locations](https://firebase.google.com/docs/database/locations) - RTDB is offered only in us-central1, europe-west1 and asia-southeast1; not europe-west3.
- cancri Implementation Brief — `design/IMPLEMENTATION_BRIEF.md` (Section 1 Platform; Section 3 Governance & security).
- Implementation Brief Appendix A — Known facts about primary source L&S (`ls-tc.de`, Frankfurt-based push).
- Implementation Brief Appendix B — Known facts about fallback Yahoo (German venue suffixes `.DE`, `.HM`, `.F`, etc.).

## More Information

- **Date:** 2026-06-27
- **Source:** cancri Implementation Brief and the architecture decomposition pass; Firebase RTDB location constraint.
- **Related ADRs:** ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0008.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created, awaiting implementation.

**Action Required:** Implement decision and audit.

### 2026-06-27

**Status:** Corrected

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Original ADR claimed all required products, incl. RTDB, were available in europe-west3 | docs/decisions/0001-pin-region-europe-west1.md | Secondary Decision Driver 3 (orig.) | factually wrong — RTDB is offered only in us-central1, europe-west1, asia-southeast1 |
| RTDB cannot be provisioned in europe-west3; deploy failed | - | - | re-pin required to an RTDB-supporting EU region |
| Codebase already used europe-west1 for the RTDB URL | apps/web/src/firebase.ts | RTDB URL (europe-west1.firebasedatabase.app) | latent inconsistency, now resolved by the re-pin |

**Summary:** Decision corrected in place (append-only rule deliberately overridden by the architect for this one record). The original choice of **europe-west3 (Frankfurt)** rested on a factual error — Firebase Realtime Database is not available in europe-west3. Because RTDB is the load-bearing tick bus (ADR-0005) and must be co-located with the feed-engine, the entire stack (Firestore, RTDB, Cloud Run feed-engine, Functions, Storage, Cloud Run Job, Vertex AI) is re-pinned to **europe-west1 (Belgium)** — the only EU region that offers RTDB. EU residency and single-region co-location are preserved; the sole cost is a marginally higher RTT to the Frankfurt-based upstreams. File renamed to `0001-pin-region-europe-west1.md`.

**Action Required:** Implement provisioning in europe-west1 and audit.
