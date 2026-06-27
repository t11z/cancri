---
title: "Three Runtime Classes: Functions, Run, Browser Job"
description: "Split work by lifecycle across request-scoped Cloud Functions, one always-on Cloud Run service, and an on-demand Cloud Run Job."
type: adr
category: architecture
tags: [runtime-topology, cloud-run, cloud-functions]
status: accepted
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [firebase, cloud-functions, cloud-run, cloud-run-jobs, playwright]
---

# ADR-0002: Three Runtime Classes: Functions, Always-On Cloud Run, Browser Job

## Status

Accepted

## Context

### Background and Problem Statement

cancri is a Firebase-hosted, access-gated, read-only live-portfolio terminal. The brief (section 1) pins the platform to Firebase Hosting, Firebase Auth, Gemini for the LLM, and data that stays inside the Firebase project, but explicitly leaves the "server-side execution mechanism within Firebase" to the implementer. That single open choice is load-bearing: the brief's section C demands a *truly live* L&S tap over the deprecated Lightstreamer 6 push (Appendix A), a Yahoo WebSocket fallback that doubles as a runtime sanity oracle (Appendix B, section D), and a self-healing capture-and-diff that drives a real browser during trading hours (section D). These three kinds of work have fundamentally different lifecycles, and the platform's serverless primitives do not all support all three.

The load-bearing fact is that Cloud Functions are request-scoped: an instance exists to serve an invocation and is torn down (or frozen) afterwards, with no guarantee of holding a long-lived outbound socket. The L&S Lightstreamer connection and the Yahoo WebSocket are *persistent* sockets that must stay open continuously through trading hours and emit only the latest tick with no history (Appendix A). A request-scoped runtime structurally cannot host them. At the same time, the heavy Playwright capture-and-diff is an occasional, bursty, minutes-long browser job that would be wasteful to keep warm. And the remaining work — Gemini normalise/confirm, the logo fetch/cache, the ISIN instrument-search proxy — is genuinely request-shaped and cheap.

This ADR records the decision to stop forcing one runtime to do all three jobs and instead split work by lifecycle into three runtime classes. It is hard to reverse because IAM bindings, deployment pipelines, the in-process tap loop, the in-memory sanity-oracle comparison, and the RTDB writer all get built directly on top of this topology; unwinding it later means re-homing live sockets, re-wiring service-account permissions, and re-validating the price path under load.

### Current Limitations

1. There is no prior runtime topology — this is a greenfield decomposition pass — so the "current" state is the naive default of "put everything in Cloud Functions," which cannot hold the L&S/Yahoo sockets at all.
2. A pure-Functions model has no place to run the always-on tap loop, so the live-price acceptance criteria (section C, truly live ticks; automatic degradation) cannot be met.
3. Without a dedicated browser runtime, the trading-hours capture-and-diff (section D) would either keep an expensive instance warm permanently or have nowhere defined to run.
4. Co-locating the L&S and Yahoo taps for the in-memory sanity comparison (cross-cutting decision 1) is impossible if sockets cannot be held in the first place.

## Decision Drivers

### Primary Decision Drivers

1. **Functions cannot hold sockets (the no-sockets truth)**: Request-scoped Cloud Functions cannot keep the persistent L&S Lightstreamer and Yahoo WebSocket connections open. This single constraint forces *some* always-on runtime and is the spine the other four subsystems hang off (cross-cutting decision 1).
2. **In-memory sanity oracle**: The probe must compare L&S vs Yahoo prices with no cross-service hop (section D, sanity check within X%). That mandates both taps in one process, which mandates exactly one always-on service — a property only a long-lived runtime can provide.
3. **Lifecycle fit per role**: Gemini normalise/confirm, logo, and ISIN search are request-shaped and benefit from scale-to-zero; the tap loop must never scale to zero; the browser capture is bursty and minutes-long. Mapping each role to the runtime whose lifecycle matches minimises both cost and operational surface.
4. **Firebase-only platform constraint**: The platform is fixed to the Firebase/GCP project (section 1). Cloud Functions, Cloud Run, and Cloud Run Jobs are all first-class inside that boundary, so the split needs no external infrastructure and keeps data in-project.

### Secondary Decision Drivers

1. **Server-side secrets**: All source access and key-touching Gemini calls must run server-side with no secrets in the client (section 3). Distinct managed runtimes let each role hold only the service-account identity and secrets it needs, narrowing blast radius.
2. **Read-only product**: cancri executes no orders (section 4). The runtime topology only ever reads upstreams and writes the tick bus, so the heavy machinery is the live feed and the self-heal, not transactional safety — which justifies investing the always-on budget in exactly one feed service.
3. **Operational simplicity / managed surface**: Managed serverless runtimes remove OS patching and give per-role autoscaling, so a tiny team can operate the system without standing infrastructure.
4. **Design handover motion**: The frontend must drive smooth handover animation from a steady tick stream (section F). A continuously-running feed service produces that steady stream; request-scoped cold starts would not.

## Considered Options

### Option 1: Functions + Always-On Cloud Run Service + Cloud Run Job

**Description**: Split work by lifecycle into three runtime classes inside the Firebase/GCP project: request-scoped Cloud Functions for Gemini normalise/confirm, logo, and the ISIN instrument-search proxy; one always-on Cloud Run service (feed-engine, min-instances=1, concurrency=1, max-instances=1) holding both the L&S Lightstreamer socket and the Yahoo WebSocket in a single process and acting as the sole writer of normalised ticks to RTDB; and an on-demand Cloud Run Job for the Playwright capture-and-diff that fires only after sustained probe failure.

**Technical Characteristics**:
- Three managed runtimes, each matched to a lifecycle: request-scoped, always-on, and on-demand batch.
- feed-engine pinned to exactly one instance (min=max=1, concurrency=1) so both taps share one process memory and the sanity oracle compares L&S vs Yahoo in-memory with no network hop.
- Functions scale to zero and hold only the IAM each needs (Vertex AI for Gemini, Storage for logo cache).
- The Cloud Run Job is invoked by the self-heal path, runs Playwright for minutes, then exits to zero cost.
- All three live in the same project under per-runtime service accounts; data never leaves the Firebase boundary.

**Advantages**:
- The only option that can actually hold the persistent L&S/Yahoo sockets while satisfying the in-memory oracle (drivers 1, 2).
- Cost-efficient: only the single feed-engine instance is always paid for; Functions and the Job scale to zero.
- Minimal operational surface — no OS patching, per-role autoscaling, managed deploys.
- Tight blast-radius: each role carries only its own service-account identity and secrets (driver, section 3).
- Steady tick stream feeds the handover motion without cold-start jitter.

**Disadvantages**:
- Three runtime classes mean three deployment shapes and three sets of IAM to reason about — more moving parts than a single artifact.
- The single-instance feed-engine is a deliberate single point of failure for live ticks (mitigated by automatic Yahoo degradation and the self-heal watchdog, ADR-0010).
- The split is hard to reverse: IAM, deploy pipelines, the tap loop, and the RTDB writer all bind to this topology.

**Risk Assessment**:
- **Technical Risk**: Low. Each runtime is used squarely within its intended model; the only novel piece (persistent sockets on Cloud Run) is the documented always-on pattern.
- **Schedule Risk**: Medium. Standing up three runtimes plus their IAM is more upfront wiring than one artifact, though each piece is well-trodden.
- **Ecosystem Risk**: Low. Functions, Cloud Run, and Cloud Run Jobs are GA, first-class Firebase/GCP primitives with long support horizons.

### Option 2: Everything on Cloud Functions

**Description**: Implement every server-side role — Gemini, logo, ISIN search, the L&S and Yahoo taps, and the capture-and-diff — as Cloud Functions, leaning on scheduled/triggered invocations to re-establish source connections.

**Technical Characteristics**:
- One runtime class, one deployment shape, one IAM model.
- Sources would have to be polled or reconnected per invocation rather than held open.
- No shared long-lived process, so any L&S-vs-Yahoo comparison crosses invocation/storage boundaries.

**Advantages**:
- Simplest possible operational and deployment story — a single runtime to learn and manage.
- Uniform scale-to-zero billing for the request-shaped roles.
- Fully inside Firebase with the least conceptual surface.

**Disadvantages**:
- Structurally cannot hold the persistent L&S Lightstreamer and Yahoo WebSocket sockets — request-scoped instances are torn down/frozen between invocations (driver 1). This alone fails the truly-live acceptance criterion.
- The Lightstreamer 6 protocol expects a continuous session with handshake and idle params (Appendix A); per-invocation reconnect churn fights the protocol and the source's session model.
- The sanity oracle cannot compare both sources in-memory; every probe becomes a cross-store round-trip, adding latency and drift to the X% check.
- Long-running Playwright capture would strain Function execution limits.

**Risk Assessment**:
- **Technical Risk**: High. The core live-feed requirement is unmet by the runtime's fundamental model, not by tuning.
- **Schedule Risk**: High. Time would be spent fighting reconnect semantics and oracle plumbing before discovering the model cannot deliver live ticks.
- **Ecosystem Risk**: Low. Cloud Functions themselves are GA and stable; the risk is fit, not longevity.

**Disqualifying Factor**: Request-scoped Functions cannot hold the persistent sockets the live-price layer requires; this option cannot meet section C at all.

### Option 3: A Single Always-On Compute Engine VM for All Roles

**Description**: Run one always-on Compute Engine VM hosting every role — the taps, the request handlers, and the browser capture — as long-running processes on a self-managed host.

**Technical Characteristics**:
- One box holds the persistent sockets, the request endpoints, and Playwright together.
- Operator owns the OS, runtime, patching, and process supervision.
- No scale-to-zero; the VM (and the heavy browser dependencies) are always provisioned.

**Advantages**:
- Trivially holds long-lived sockets and co-locates both taps for the in-memory oracle.
- Full control over the process, kernel, and network stack — useful for the byte-level Lightstreamer subprotocol and origin requirements (Appendix A).
- One host to reason about for connectivity.

**Disadvantages**:
- Manual patching and OS lifecycle — security and operational burden the managed options avoid (driver, section 3 simplicity).
- No scale-to-zero on the heavy capture: the Playwright/browser footprint is provisioned permanently even though capture-and-diff runs rarely.
- Co-tenanting request handlers, the tap loop, and a browser on one host couples failure domains — a capture crash or memory spike can take down the live feed.
- Reintroduces standing infrastructure into an otherwise Firebase-native project, widening the blast radius for secrets.

**Risk Assessment**:
- **Technical Risk**: Medium. The pieces work, but a single shared host couples failure domains that the runtime split deliberately separates.
- **Schedule Risk**: Medium. Building VM provisioning, supervision, and patching pipelines costs more sustained effort than managed deploys.
- **Ecosystem Risk**: Medium. Self-managed hosts drift from the managed-Firebase grain and become an ongoing maintenance liability.

### Option 4: GKE for All Roles

**Description**: Run a Kubernetes (GKE) cluster and schedule every role — taps, request handlers, and capture-and-diff — as deployments/jobs on the cluster.

**Technical Characteristics**:
- Full orchestration: deployments for always-on work, Jobs for the browser capture, horizontal autoscaling for request roles.
- Cluster control plane, node pools, and networking to operate.
- Rich primitives (affinity, PodDisruptionBudgets, secrets) available but unused at this scale.

**Advantages**:
- Can model all three lifecycles (always-on, request, batch) within one platform.
- Mature ecosystem and fine-grained control for future scale.
- Holds persistent sockets and co-locates taps comfortably.

**Disadvantages**:
- Massive overkill for one tap, a handful of request handlers, and an occasional browser job — the operational weight of a cluster dwarfs the workload.
- Control-plane and node-pool management reintroduce the patching/ops burden the managed serverless options remove.
- Steepens the learning and deployment curve for a small team versus Firebase-native primitives.
- Higher baseline cost than a single pinned Cloud Run instance plus scale-to-zero Functions.

**Risk Assessment**:
- **Technical Risk**: Low. Kubernetes can certainly run all of it; the technology is proven.
- **Schedule Risk**: High. Cluster setup, manifests, and ops tooling are a large upfront and ongoing cost for this footprint.
- **Ecosystem Risk**: Low. GKE is GA and stable, but the operational commitment is disproportionate.

## Decision

We adopt **Option 1: Functions + an always-on Cloud Run service + a Cloud Run Job** — work is split by lifecycle into three runtime classes.

The implementation will use:
- **Cloud Functions (request-scoped)** for the Gemini normalise/confirm Callable (ADR-0008), the logo fetch/cache Function, and the ISIN instrument-search proxy — each scaling to zero and holding only the IAM it needs.
- **One always-on Cloud Run service, feed-engine** (min-instances=1, concurrency=1, max-instances=1) holding both the L&S Lightstreamer socket and the Yahoo WebSocket in a single process, running the in-memory sanity oracle, and acting as the sole writer of normalised ticks to RTDB `/quotes/{isin}` and `/feed/status` via the Admin SDK (ADR-0003, ADR-0005).
- **An on-demand Cloud Run Job** for the Playwright capture-and-diff, invoked by the self-heal path only after sustained probe failure, running for minutes and then returning to zero cost (ADR-0010).

All three runtimes live inside the Firebase/GCP project under per-role service accounts, so data and secrets never leave the project boundary.

## Consequences

### Positive

1. **Live ticks become possible**: The always-on feed-engine can hold the persistent L&S/Yahoo sockets, satisfying the truly-live acceptance criterion the pure-Functions default cannot.
2. **In-memory sanity oracle for free**: Pinning both taps to one single-concurrency instance lets the probe compare L&S vs Yahoo prices in-process with no cross-service hop (driver 2).
3. **Cost discipline**: Only one feed-engine instance is permanently paid for; Functions and the capture Job scale to zero, so the bursty browser work costs nothing when idle.
4. **Tight blast radius**: Each role carries only its own service-account identity and secrets, aligning with the no-secrets-in-client governance (section 3).
5. **Steady stream for handover motion**: A continuously running feed produces a jitter-free tick stream for the rAF-driven animations (section F).

### Negative

1. **Single point of failure for live ticks**: feed-engine is pinned to exactly one instance; if it dies, live L&S ticks stop until restart or degradation. This is inherent to the in-memory-oracle requirement.
2. **More moving parts**: Three runtime classes mean three deployment shapes and three IAM surfaces to build and reason about, versus one artifact.
3. **Hard to reverse**: IAM bindings, deploy pipelines, the tap loop, and the RTDB writer all bind to this topology; re-homing live sockets later is expensive and touches the price-critical path.
4. **Concurrency ceiling on the feed**: max-instances=1 / concurrency=1 means the feed-engine cannot horizontally scale; growth must come from vertical sizing or a deliberate re-architecture.

### Neutral

1. **GCP runtime lock-in**: The topology binds cancri to Cloud Functions, Cloud Run, and Cloud Run Jobs — acceptable because the platform is already fixed to Firebase (section 1).
2. **Cloud Run 60-min connection cap is sidestepped**: clients never hold a Cloud Run connection; they subscribe to RTDB instead (ADR-0005), so the cap is irrelevant to the data path.
3. **A documented escape hatch exists**: authenticated SSE/WS straight from the feed-engine is recorded as the fallback transport should RTDB fan-out ever prove insufficient (ADR-0005).

## Decision Outcome

Each functional objective is met by the runtime whose lifecycle fits it: live-price persistence (section C) by the always-on feed-engine, the request-shaped Gemini/logo/ISIN roles (sections B, E) by Cloud Functions, and the bursty trading-hours capture-and-diff (section D) by the Cloud Run Job. The in-memory sanity oracle is satisfied because both taps share one pinned process, and the Firebase-only and server-side-secrets constraints hold because every runtime stays in-project under a scoped service account.

Mitigations:
- For the single-point-of-failure feed-engine: automatic degradation to the delayed Yahoo fallback keeps the dashboard visible-and-marked-delayed rather than dark (section C), and the self-heal watchdog plus `/healthz` probe restart/alert on liveness loss (ADR-0010).
- For the extra moving parts and IAM surface: per-role service accounts and infrastructure-as-code deploys keep the three runtimes auditable and reproducible.
- For hard reversibility: the data-contracts seam (ADR-0006) and the documented SSE/WS escape hatch (ADR-0005) keep client and transport decoupled from the runtime topology, so a future re-home need not ripple to clients.
- For the feed-engine concurrency ceiling: the read-only, single-tap workload is well within one instance today; any scale-out is a deliberate, recorded future ADR.

## Related Decisions

- [ADR-0003: Feed-Engine Always-On Service](0003-feed-engine-single-process-singleton.md) - Details the always-on Cloud Run service this topology introduces (the taps, oracle, and RTDB writer).
- [ADR-0004: Two-Store Datastore Split](0004-datastore-split-firestore-book-rtdb-wire.md) - The Firestore book vs RTDB wire split that the runtimes read and write.
- [ADR-0005: RTDB as the Tick Bus / Transport](0005-realtime-transport-rtdb-tick-bus.md) - Why clients subscribe to RTDB rather than holding a Cloud Run connection, sidestepping the 60-min cap.
- [ADR-0006: Shared Data-Contracts Package](0006-tick-schema-and-source-adapter-contract.md) - The single seam that keeps clients decoupled from this runtime topology.
- [ADR-0008: Gemini Normalisation via Callable Function](0008-gemini-vertex-iam-callable.md) - A request-scoped Function role placed by this split.
- [ADR-0010: Self-Heal Probe, Watchdog and Capture Job](0010-self-heal-governance-pr-deterministic-gate.md) - The on-demand Cloud Run Job role and the feed-engine watchdog.

## Links

- [cancri Implementation Brief](../../design/IMPLEMENTATION_BRIEF.md) - Functional brief; section 1 (fixed platform), section C (live data layer), section D (self-healing), section 3 (governance/security).
- [Implementation Brief, Appendix A — L&S](../../design/IMPLEMENTATION_BRIEF.md) - Lightstreamer 6 persistent-session facts and the bounded break surface that the always-on tap must host.
- [Implementation Brief, Appendix B — Yahoo](../../design/IMPLEMENTATION_BRIEF.md) - Yahoo WebSocket facts; the co-located fallback and sanity oracle.

## More Information

- **Date:** 2026-06-27
- **Source:** cancri Implementation Brief (sections 1, C, D, 3; Appendices A & B); cross-cutting decisions 1–6.
- **Related ADRs:** ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0008, ADR-0010.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created, awaiting implementation.

**Action Required:** Implement decision and audit.
