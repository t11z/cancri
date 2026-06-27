---
title: "Firestore Is the Book; RTDB Is the Wire"
description: "Durable per-user inventory lives in Firestore while ephemeral high-frequency ticks and global feed status live in Realtime Database, on a public-quote / private-holding privacy split."
type: adr
category: data
tags: [datastore, firestore, realtime-database, privacy]
status: accepted
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [firestore, firebase-realtime-database, firebase-auth, cloud-run]
---

# ADR-0004: Firestore Is the Book; RTDB Is the Wire

## Status

Accepted

## Context

### Background and Problem Statement

cancri is a read-only live-portfolio terminal. The brief fixes two hard platform
constraints that bound this decision: data must stay inside the Firebase project
(§1), and per-user isolation must be enforced by datastore security rules (§2.A,
§3). Within that envelope, cancri carries two workloads with diametrically opposed
access patterns.

The first is **the book**: each user's confirmed inventory — resolved instrument
identity (ISIN/symbol), quantity, optional cost basis, the Gemini-proposed drafts
awaiting confirmation, an append-only audit trail, the ISIN→instrument map, and
logo metadata. This data is durable, low-write, strongly per-user-scoped, and needs
real queries and a tight rules model ("you see only your own data", §2.A, §5). It is
written rarely — only when a user confirms an inventory change — and read on session
load.

The second is **the wire**: the normalised price tick stream. The feed-engine
(ADR-0003) holds the L&S Lightstreamer socket and the Yahoo WS in one process and
emits ticks for every held instrument as they arrive — multi-Hz during active
trading. Each tick (`lastPrice`, day change, `timestamp`, `source`, `freshness`)
overwrites the prior value for that ISIN; history is explicitly out of scope (the
L&S socket sends only the latest tick, Appendix A). This data is ephemeral,
extremely high-write, and — critically — **not private**. A price is not "yours"; it
is a public fact about an instrument.

Forcing both workloads into one store mismodels at least one of them. The decision
is which Firebase store backs which workload, and how the privacy boundary is drawn.

This is **hard to reverse**. The store choice leaks into security-rules files
(two different rules languages and models), into the client SDK calls (`firestore`
vs `database` namespaces with different listener and offline semantics), into the
feed-engine's Admin-SDK write path (ADR-0003), into the transport contract clients
subscribe against (ADR-0005), and into the `Tick` and inventory schemas in
`packages/data-contracts` (ADR-0006). Migrating live ticks from RTDB to another
store after launch would mean rewriting the sole-writer path, every client
subscription, and the privacy rules simultaneously — a coordinated change across
every subsystem, not a local refactor.

### Current Limitations

1. There is no datastore yet; without a split, a single store would be forced to
   serve both a low-write private book and a multi-Hz public tick stream, mispricing
   or rate-limiting one of them.
2. Firestore bills per document write and caps sustained writes at roughly one per
   document per second — structurally hostile to overwriting a quote many times a
   second.
3. A naive "one store for everything" design entangles the privacy boundary: holdings
   (private) and quotes (public) would share a rules surface, making it easy to leak
   one user's positions or to over-restrict shared price data.

## Decision Drivers

### Primary Decision Drivers

1. **Write economics and rate ceiling for multi-Hz ticks**: Firestore's per-write
   billing and ~1 write/document/second sustained ceiling make it unfit for a quote
   that updates many times per second. RTDB bills on bandwidth and concurrent
   connections, and overwrite-in-place at `/quotes/{isin}` keeps stored volume flat
   regardless of tick rate.
2. **Correct privacy modelling**: the boundary is *what you own*, not *what a price
   is*. Holdings under `/users/{uid}/*` must be uid-gated and unreachable by other
   users (§2.A, §5); `/quotes/{isin}` is a shared public fact readable by any
   signed-in user. These two access patterns deserve two stores with two distinct
   rules surfaces, so a quote-rule change can never widen holding visibility.
3. **Free realtime plumbing for the wire**: the Firebase RTDB SDK gives clients
   auth, fan-out, reconnect, and an offline cache without bespoke code, and dodges
   Cloud Run's 60-minute connection cap by decoupling the always-on feed-engine
   writer from client subscribers (ADR-0003, ADR-0005).
4. **Firebase-only platform constraint**: data must stay inside the Firebase project
   (§1). Firestore and RTDB are both first-party; neither adds infrastructure
   outside the project, unlike an external timeseries/cache store.

### Secondary Decision Drivers

1. **Strong query and rules model for the book**: Firestore's document/collection
   queries and granular rules fit inventory, drafts, and an append-only audit better
   than RTDB's tree model.
2. **Single shared seam, source-agnostic**: the `Tick` and inventory schemas live in
   `packages/data-contracts` (ADR-0006); nothing source-specific crosses it. The
   store split is invisible above that seam — the client subscribes to normalised
   ticks regardless of where they sit.
3. **Sole-writer integrity**: the feed-engine is the *only* writer to `/quotes` and
   `/feed/status` via the Admin SDK (ADR-0003); RTDB rules can deny all client writes
   to the wire, making the public quote space read-only to clients by construction.
4. **Cost predictability**: overwrite-in-place means tick storage does not grow with
   trading volume; only bandwidth and connection count scale, both of which track
   active users rather than market activity.

## Considered Options

### Option 1: Firestore for the Book (cold, uid-scoped) + RTDB for the Wire (hot, public quotes + global status)

**Description**: Split by access pattern. Firestore holds the durable per-user book —
inventory, Gemini drafts, append-only audit, ISIN→instrument map, logo metadata —
all under `/users/{uid}/*` gated by uid rules. RTDB holds the ephemeral wire — the
feed-engine overwrites `/quotes/{isin}` in place and maintains a global `/feed/status`
node, both world-readable to signed-in users and writable only by the Admin SDK.

**Technical Characteristics**:
- Two first-party Firebase stores, two rules files, two SDK namespaces on the client.
- `/quotes/{isin}` overwritten in place per tick; storage stays flat, ISIN is the node key.
- `/feed/status` single global node carries live/delayed/degraded feed state.
- Firestore writes only on user confirmation; reads on session load.
- Privacy boundary: public `/quotes` (signed-in read) vs private `/users/{uid}` (owner-only).
- Feed-engine is sole RTDB writer via Admin SDK (ADR-0003); clients are read-only on the wire.

**Advantages**:
- Each store matches its workload: cheap durable queries for the book, flat-cost high-frequency overwrite for the wire.
- RTDB SDK provides reconnect, fan-out, and offline cache for free, and sidesteps Cloud Run's 60-min connection cap.
- Clean, separable privacy surfaces — quote rules cannot widen holding visibility and vice versa.
- No infrastructure outside the Firebase project; satisfies the Firebase-only constraint.
- ISIN-keyed quote nodes align with the canonical join key end to end (ADR-0007).

**Disadvantages**:
- Two stores to operate, secure, and reason about; contributors must learn which data lives where.
- Two distinct rules languages and security models to keep correct.
- A read that spans book + live price must join across stores on the client (by ISIN).
- The split is hard to undo once rules, SDK calls, and the writer path depend on it.

**Risk Assessment**:
- **Technical Risk**: Low. Both stores are mature first-party Firebase products with well-understood semantics; the split is the canonical Firebase pattern for hot vs cold data.
- **Schedule Risk**: Low. No external infra to stand up; rules and schemas are bounded and known up front.
- **Ecosystem Risk**: Low. Firestore and RTDB are core, long-supported Firebase services with stable client and Admin SDKs.

### Option 2: Firestore for Everything, Including Ticks

**Description**: Use a single store. Inventory, drafts, audit *and* the live tick
stream all live in Firestore, with ticks written as overwrite-in-place documents
under a quotes collection.

**Technical Characteristics**:
- One store, one SDK namespace, one rules file.
- Each tick is a document write, billed per write.
- Sustained writes to a single document are capped at roughly one per second.
- Client listens to quote documents via Firestore snapshot listeners.

**Advantages**:
- Single store to operate, secure, and learn — lowest conceptual surface.
- One rules model and one query language across all data.
- Strong queries available even over quote data if ever needed.

**Disadvantages**:
- Per-write billing turns a multi-Hz feed into a runaway cost; every tick for every held instrument is a billable write.
- The ~1 write/document/second ceiling throttles exactly the high-frequency overwrite the wire needs, dropping or queuing ticks.
- Firestore listeners are not built for sustained multi-Hz churn; latency and cost both degrade.
- Forces public price data and private holdings to share one rules surface, entangling the privacy boundary.

**Risk Assessment**:
- **Technical Risk**: High. The write-rate ceiling directly conflicts with the core requirement of cent-accurate live ticks; the architecture would throttle its own primary feature.
- **Schedule Risk**: Medium. Initial build is simple, but cost/throttling problems surface only under realistic tick load, forcing a late, expensive re-architecture.
- **Ecosystem Risk**: Low. Firestore itself is stable; the risk is misuse, not the product.

**Disqualifying Factor**: Per-write billing plus the write-rate ceiling make Firestore structurally incapable of carrying a multi-Hz tick stream at acceptable cost or latency.

### Option 3: RTDB for Everything, Including the Book

**Description**: Use a single store. Put both the live wire and the durable per-user
book in Realtime Database, modelling inventory, drafts, and audit as JSON subtrees
under `/users/{uid}`.

**Technical Characteristics**:
- One store, one SDK namespace, RTDB rules everywhere.
- Inventory and audit modelled as nested JSON trees rather than documents.
- Queries limited to RTDB's index/orderBy model; no rich compound queries.
- Append-only audit modelled by hand within the tree.

**Advantages**:
- Single store to operate; the wire workload is already a natural RTDB fit.
- Shared SDK and reconnect/offline behaviour across all data.
- Flat-cost overwrite economics extend trivially to any high-frequency data.

**Disadvantages**:
- RTDB's query and indexing model is weak for inventory: filtering, compound queries, and structured audit are awkward and easy to get wrong.
- Rules for a durable per-user book are harder to express and validate than Firestore's document rules, raising the chance of an isolation bug.
- Modelling an append-only audit and drafts in a JSON tree is brittle relative to Firestore documents.
- Mixing private holdings and public quotes in one store muddies the privacy boundary the brief demands.

**Risk Assessment**:
- **Technical Risk**: Medium. RTDB can store the book, but its weaker query/rules model raises the likelihood of a per-user isolation defect — a direct hit on acceptance criterion §5.
- **Schedule Risk**: Medium. Hand-rolling queries, audit structure, and tighter rules in RTDB costs more than using Firestore's native primitives.
- **Ecosystem Risk**: Low. RTDB is stable; the cost is fit, not maturity.

### Option 4: External Timeseries / Cache Store for Ticks

**Description**: Keep the book in Firestore but route the live wire through an
external timeseries or in-memory cache (e.g. a managed Redis/timeseries service)
sitting beside the Firebase project, with clients reaching it via the feed-engine.

**Technical Characteristics**:
- Three stores: Firestore (book), external cache (wire), plus whatever fan-out layer the cache needs.
- Clients can no longer subscribe directly; the feed-engine must proxy a transport (SSE/WS) to fan ticks out.
- Auth, reconnect, offline cache, and fan-out become bespoke rather than SDK-provided.
- Infrastructure now lives partly outside the Firebase project.

**Advantages**:
- A purpose-built timeseries/cache can absorb very high write rates efficiently.
- Decouples tick storage from Firebase pricing models entirely.
- Could retain tick history if that ever became in scope.

**Disadvantages**:
- Violates the platform constraint that data stays inside the Firebase project (§1).
- Loses the free RTDB SDK plumbing — auth, fan-out, reconnect, offline must be rebuilt and secured by hand.
- Forces clients onto a feed-engine-proxied transport, putting the Cloud Run 60-min connection cap back on the critical path (ADR-0005).
- Adds operational surface (a third datastore) for a feature — tick history — the brief explicitly excludes.

**Risk Assessment**:
- **Technical Risk**: Medium. The store itself is capable, but the bespoke auth/fan-out/transport layer it forces is exactly the complexity RTDB removes, and reintroduces the connection-cap problem.
- **Schedule Risk**: High. Standing up and securing external infra plus a custom fan-out transport is materially more work than using two first-party stores.
- **Ecosystem Risk**: Medium. Adds a non-Firebase dependency with its own SLAs, IAM, and lifecycle, against an explicit Firebase-only mandate.

**Disqualifying Factor**: It breaches the Firebase-only data constraint and pays for capacity (history, extreme write rates) that the brief does not need, while discarding the free realtime plumbing RTDB provides.

## Decision

Adopt **Option 1**: split the datastore by access pattern. **Firestore is the book**;
**Realtime Database is the wire**.

The implementation will use:
- **Firestore** for the durable per-user book — `/users/{uid}/inventory`, drafts,
  an append-only audit subtree, the ISIN→instrument map, and logo metadata — gated by
  security rules that allow access only where `request.auth.uid` matches the path
  owner. Writes occur only on user confirmation (ADR-0008 Gemini proposes, user
  disposes); reads occur on session load.
- **Realtime Database** for the ephemeral wire — the feed-engine overwrites
  `/quotes/{isin}` in place on every normalised tick and maintains a single global
  `/feed/status` node, both via the Admin SDK as sole writer (ADR-0003). RTDB rules
  grant read to any signed-in user and deny all client writes.
- **ISIN** as the `/quotes` node key, matching the canonical identity used end to end
  (ADR-0007); the client joins its private Firestore holdings to public RTDB quotes
  by ISIN at render time.
- **`packages/data-contracts`** (ADR-0006) as the only schema seam: `Tick`,
  `freshness`, the feed-status shape, and the inventory schema are defined once and
  imported by `apps/web`, `services/feed-engine`, and the functions, so the store
  split never leaks source-specific detail across the boundary.

The privacy boundary is *what you own*, not *what a price is*: `/quotes/{isin}` is
shared and readable by any signed-in user; `/users/{uid}/*` holdings are uid-gated and
unreachable by other users.

## Consequences

### Positive

1. **Right tool per workload**: the book gets durable queries and granular rules; the
   wire gets flat-cost, high-frequency overwrite. Neither workload is throttled or
   mispriced by the other.
2. **Bounded, predictable cost**: overwrite-in-place keeps tick storage flat; only
   bandwidth and connections scale, tracking active users rather than market volume.
3. **Free realtime plumbing**: RTDB's SDK delivers auth, fan-out, reconnect, and
   offline cache without bespoke code, and decouples client subscriptions from the
   always-on writer, sidestepping Cloud Run's 60-min connection cap.
4. **Clean privacy surfaces**: public quotes and private holdings live in separate
   stores with separate rules, so a change to quote visibility can never widen holding
   visibility — directly serving the per-user isolation acceptance criterion (§5).
5. **Firebase-only honoured**: both stores are first-party; no infrastructure leaves
   the Firebase project.

### Negative

1. **Two stores, two mental models**: contributors must know which data lives where,
   and maintain two distinct rules languages and security models — a permanent
   cognitive and review tax.
2. **Cross-store joins on the client**: presenting a holding with its live price means
   joining Firestore inventory to RTDB quotes by ISIN in the client, rather than a
   single query. A mismatch in ISIN keys surfaces as a missing price.
3. **Two rules surfaces to keep correct**: a security defect can hide in either rules
   file; both must be tested. Two surfaces is more attack surface than one.
4. **Hard to reverse**: the split is wired into rules, client SDK calls, the
   feed-engine writer path, the transport contract (ADR-0005), and the shared schemas
   (ADR-0006). Undoing it post-launch is a coordinated multi-subsystem change, not a
   local refactor.
5. **No tick history**: overwrite-in-place is deliberate; if history ever became a
   requirement, RTDB-as-wire would not satisfy it without a new store.

### Neutral

1. **ISIN as join key**: the client-side join is only as good as ISIN consistency,
   which is already an invariant the architecture commits to elsewhere (ADR-0007).
2. **Sole-writer constraint**: making the feed-engine the only `/quotes` writer is a
   property of the feed-engine topology (ADR-0003), enforced here by RTDB rules denying
   client writes.
3. **Transport choice is downstream**: that clients subscribe to RTDB directly (rather
   than a feed-engine-proxied SSE/WS) is decided in ADR-0005; this ADR only fixes where
   the ticks live.

## Decision Outcome

The objectives are met: the multi-Hz wire runs on a store whose economics (bandwidth +
connections, flat overwrite storage) and SDK (free reconnect/offline/fan-out) fit it,
while the durable book runs on a store whose queries and granular rules fit it. The
Firebase-only constraint (§1) holds because both stores are first-party. The per-user
isolation criterion (§2.A, §5) is served by drawing the privacy boundary on ownership:
public `/quotes`, private `/users/{uid}`, in separate stores with separate rules. The
Cloud Run 60-min connection cap is avoided by decoupling subscribers from the writer
through RTDB (ADR-0003, ADR-0005).

Mitigations:
- **Two mental models / two rules surfaces**: document the "Firestore = book, RTDB =
  wire" split prominently, and test both rules files with explicit allow/deny cases,
  especially that no signed-in user can read another user's `/users/{uid}` subtree and
  that no client can write `/quotes` or `/feed/status`.
- **Cross-store join fragility**: make ISIN the single quote key and reuse the
  canonical ISIN identity (ADR-0007); treat a missing `/quotes/{isin}` for a held
  position as a render-state (no live price) rather than an error.
- **Hard reversibility**: keep all tick/inventory/feed-status shapes in
  `packages/data-contracts` (ADR-0006) so the store boundary is the only thing that
  would change if a future ADR ever re-homes the wire, and document the
  authenticated-SSE/WS escape hatch (ADR-0005) as the sanctioned alternative path.
- **No history**: explicitly out of scope per the brief (Appendix A — L&S sends only
  the latest tick); revisit only if a future requirement introduces history, which
  would warrant a superseding ADR.

## Related Decisions

- [ADR-0002: Runtime Classes](0002-three-runtime-classes-execution-model.md) - establishes the runtime
  topology (Functions, Cloud Run service, Cloud Run Job) that this datastore split
  serves.
- [ADR-0003: Feed-Engine](0003-feed-engine-single-process-singleton.md) - the always-on feed-engine is the sole
  Admin-SDK writer of `/quotes` and `/feed/status` defined here.
- [ADR-0005: Transport](0005-realtime-transport-rtdb-tick-bus.md) - decides that clients subscribe to RTDB
  directly, with authenticated SSE/WS from Cloud Run as the escape hatch.
- [ADR-0006: Tick Contract](0006-tick-schema-and-source-adapter-contract.md) - defines the `Tick`, freshness,
  feed-status, and inventory schemas in `packages/data-contracts` that both stores use.
- [ADR-0007: ISIN Identity](0007-isin-resolution-llm-proposes-resolver-disposes.md) - establishes ISIN as the canonical
  key used as the `/quotes` node key and the client-side join key.
- [ADR-0008: Gemini Normalisation](0008-gemini-vertex-iam-callable.md) - produces the
  proposed inventory whose confirmed form is persisted to the Firestore book.

## Links

- cancri Implementation Brief — `design/IMPLEMENTATION_BRIEF.md` (§1 Platform; §2.A
  Authentication; §2.G Persistence; §3 Governance & security; §5 Acceptance criteria).
- Implementation Brief Appendix A — Known facts about primary source L&S (only the
  latest tick over the socket, no history).
- Implementation Brief Appendix B — Known facts about fallback Yahoo (delayed German
  venue quotes; runtime sanity oracle).

## More Information

- **Date:** 2026-06-27
- **Source:** cancri decomposition pass; Implementation Brief §1, §2.A, §2.G, §3, §5,
  Appendix A, Appendix B.
- **Related ADRs:** ADR-0002, ADR-0003, ADR-0005, ADR-0006, ADR-0007, ADR-0008.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created, awaiting implementation.

**Action Required:** Implement decision and audit.
