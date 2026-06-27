---
title: "Realtime Transport via RTDB Tick Bus"
description: "The feed-engine is the sole writer of ticks to RTDB; clients read via the Firebase SDK and never open a socket to Cloud Run."
type: adr
category: integration
tags: [realtime, transport, rtdb, cloud-run]
status: accepted
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [firebase-realtime-database, cloud-run, firebase-sdk, firebase-admin-sdk, firebase-auth]
---

# ADR-0005: Realtime Transport via RTDB Tick Bus

## Status

Accepted

## Context

### Background and Problem Statement

cancri is a read-only live-portfolio terminal whose entire value is the felt
liveness of price motion: directional tick-flash, number transition, and live
sparkline draw, all driven by a stream of normalised ticks (section F of the
brief). The ticks originate server-side in the always-on `feed-engine` Cloud
Run service, which is the only process allowed to hold the L&S Lightstreamer
socket and the Yahoo WebSocket (ADR-0002, ADR-0003). Between that producer and
many browser tabs sits a transport question: **how do normalised ticks travel
from the single feed-engine process to every signed-in client?**

This is hard to reverse because the transport choice fixes the shape of the
client subscription code, the server's write path, the auth model on the
read side, and the freshness/reconnect UX — all at once. The frontend's
single-rAF handover loop reads from a two-tier hot/cold state model that is
hydrated by whatever transport we pick; the feed-status banner (live vs delayed,
reconnect, market-closed) is rendered from the same stream. Once the client SDK
contract and the security-rules privacy plane are baked into the design
handover's motion code and the per-user gating, swapping transports means
rewriting both ends and re-deriving the auth story. The decision therefore pins
a public interface and a contract — exactly the kind of choice the README says
warrants an ADR.

The platform is fixed: Firebase Hosting, Firebase Auth, data stays inside the
Firebase project (brief section 1). Functions cannot hold sockets, so a
persistent producer already exists as Cloud Run. The open question is purely the
*last hop* to the browser.

### Current Limitations

1. Cloud Run caps a single request/connection at 60 minutes, so any
   long-lived socket straight from Cloud Run to the browser is force-closed and
   must be transparently re-established — a market session runs far longer.
2. A raw socket from Cloud Run to each client inherits none of Firebase's
   machinery: ID-token verification on the wire, fan-out to N tabs, backpressure,
   reconnection, and offline cache would all be hand-rolled.
3. The feed-engine runs `concurrency=1, max-instances=1` (ADR-0003); making it
   also terminate every client socket couples client fan-out to the one process
   that must stay free to compare L&S vs Yahoo in-memory.
4. The privacy boundary must live in declarative security rules ("public quotes,
   private holdings", ADR-0004); a bespoke socket pushes that boundary into
   imperative per-connection code that is easy to get wrong.

## Decision Drivers

### Primary Decision Drivers

1. **Auth on the read path for free**: every reader is a Firebase Auth user; the
   transport must enforce "signed-in to read quotes" without a hand-rolled
   ID-token handshake on a socket.
2. **Fan-out and reconnection are not our problem to solve**: many tabs per user
   and across users must each get the live stream with automatic reconnect and
   offline cache, without the feed-engine managing connection state.
3. **Dodge the Cloud Run 60-minute cap**: the transport must survive an
   all-session subscription without visible drops.
4. **Keep the feed-engine single-minded**: the sole-instance, concurrency-1
   service exists to hold both source sockets and run the sanity oracle in-memory
   (ADR-0002/0003); it must not also be a client-facing socket server.
5. **Privacy plane in declarative rules**: the "what you own vs what a price is"
   boundary (ADR-0004) belongs in security rules, not in per-connection
   imperative auth.

### Secondary Decision Drivers

1. **Server-side-only source internals**: the brief forbids source internals or
   secrets in the client; the transport must carry only normalised ticks from the
   shared `data-contracts` seam (ADR-0006), never source-specific framing.
2. **Read-only product**: clients never write ticks; the transport can be a
   one-way server-writes / client-reads bus with no client mutation path.
3. **Presence-gated economy**: idle tabs should be able to stop listening; the
   transport should support subscribing only to the `/quotes/{isin}` nodes a user
   actually holds.
4. **Operational simplicity inside Firebase**: staying on a managed Firebase
   product keeps the whole data plane inside the fixed platform with no extra
   infrastructure to run.

## Considered Options

### Option 1: RTDB Tick Bus (server writes, client SDK listens)

**Description**: The feed-engine, via the Admin SDK, is the sole writer of
normalised ticks to public `/quotes/{isin}` nodes (overwrite-in-place) and a
global `/feed/status`. Clients use the Firebase Realtime Database SDK to
subscribe directly to the `/quotes/{isin}` nodes for the ISINs they hold and to
`/feed/status`. No client ever opens a socket to Cloud Run.

**Technical Characteristics**:
- One-way bus: Admin SDK write on the server, SDK `onValue` listeners on the
  client; clients have no write permission to `/quotes` or `/feed/status`.
- Overwrite-in-place per ISIN means RTDB holds only the latest tick, matching
  L&S's no-history reality (Appendix A) and the hot/cold state model.
- Auth, fan-out, reconnect, and offline cache are provided by the Firebase SDK
  and the managed RTDB backend; the feed-engine holds no client connections.
- Privacy is expressed as security rules: any signed-in user may read public
  `/quotes`; private holdings stay in uid-scoped Firestore (ADR-0004).
- Subscriptions are presence/holdings-gated — a tab listens only to the ISINs in
  its inventory.

**Advantages**:
- Inherits ID-token auth, multi-tab fan-out, automatic reconnect, and offline
  cache from a managed product — none hand-rolled.
- Completely sidesteps the Cloud Run 60-minute connection cap: clients never
  connect to Cloud Run.
- Keeps the feed-engine single-instance and single-minded; client load never
  touches the oracle process.
- The privacy plane stays declarative in security rules, the same place as the
  Firestore book boundary.
- Stays entirely inside the fixed Firebase platform with no added infrastructure.

**Disadvantages**:
- Adds RTDB as a write-amplified hop in the hot path: every tick is a network
  write and a backend fan-out, with RTDB egress/storage billing on tick volume.
- Couples liveness to RTDB's consistency and latency characteristics rather than
  a direct producer→consumer socket.
- Tick shape must be flattened to JSON nodes; binary/structured framing is not
  available, and high-frequency overwrite can be throttled by RTDB write limits.
- A second datastore (alongside Firestore) is now load-bearing in the live path.

**Risk Assessment**:
- **Technical Risk**: Low. RTDB is a mature managed realtime store; the
  write/subscribe pattern is its primary use case.
- **Schedule Risk**: Low. SDK listeners and Admin-SDK writes are minimal glue; no
  bespoke socket server to build or harden.
- **Ecosystem Risk**: Low. First-party Firebase product on the fixed platform,
  long-supported, with the SSE-over-fetch escape hatch documented if needed.

### Option 2: Authenticated SSE-over-fetch from Cloud Run per client

**Description**: The feed-engine exposes an authenticated HTTP endpoint that
streams Server-Sent Events; each client opens a `fetch` stream, sends its
Firebase ID token, and the server pushes normalised ticks down the response body.

**Technical Characteristics**:
- One long-lived HTTP response per client; the server verifies the ID token at
  connect and must re-verify/refresh over the connection lifetime.
- The feed-engine becomes a client-facing fan-out server: it tracks every open
  response, filters ticks per subscriber's holdings, and handles backpressure.
- Reconnection (`Last-Event-ID`), heartbeat, and resume semantics are
  application code.

**Advantages**:
- One-way, text-based, firewall-friendly; SSE is simple on the wire and needs no
  extra product.
- Direct producer→consumer path with no intermediate datastore write, so the tick
  shape is whatever the server emits.
- This is the brief-sanctioned escape hatch, so the design is already understood
  as a fallback.

**Disadvantages**:
- Re-implements auth, fan-out, backpressure, and reconnection by hand — exactly
  what RTDB gives for free.
- Fights the Cloud Run 60-minute cap: every SSE stream is force-closed each hour
  and must transparently reconnect.
- Loads the single concurrency-1 feed-engine with N client connections,
  contending with the in-memory sanity oracle, or forcing a separate fan-out tier.
- Privacy filtering moves into imperative per-connection code instead of
  declarative rules.

**Risk Assessment**:
- **Technical Risk**: Medium. Correct token-refresh, resume, and per-client
  filtering on a long-lived stream are easy to get subtly wrong.
- **Schedule Risk**: Medium. A bespoke fan-out/auth/reconnect layer is real build
  and test effort versus SDK glue.
- **Ecosystem Risk**: Medium. Collides with Cloud Run's documented connection cap;
  retained only as the documented escape hatch.

### Option 3: WebSocket from Cloud Run to each client

**Description**: The feed-engine (or a dedicated Cloud Run service) terminates a
WebSocket from every browser, authenticates each socket with the Firebase ID
token, and pushes ticks bidirectionally.

**Technical Characteristics**:
- Full-duplex socket per client held open for the trading session.
- Server maintains the socket registry, per-socket subscription set, heartbeats,
  and backpressure; auth is an application handshake over the socket.
- Bidirectional channel even though the product is read-only.

**Advantages**:
- Lowest-latency, binary-capable channel with arbitrary framing.
- A single mechanism could carry both ticks and any future client→server
  realtime messages.

**Disadvantages**:
- Same Cloud Run 60-minute cap, now on a stateful duplex socket that is more
  disruptive to re-establish than SSE.
- Maximum operational burden: connection registry, fan-out, backpressure,
  heartbeat, and a hand-rolled ID-token auth handshake — all on the single
  concurrency-1 process or a new tier.
- Full-duplex is overkill for a read-only terminal; the write direction is dead
  weight and an extra attack surface.
- Privacy boundary lives in imperative per-socket code, away from security rules.

**Risk Assessment**:
- **Technical Risk**: High. Stateful duplex sockets with custom auth and fan-out
  are the most error-prone option and the hardest to make robust under reconnect.
- **Schedule Risk**: High. Most code to build and harden of all options.
- **Ecosystem Risk**: Medium. Cloud Run supports WebSockets but the 60-minute cap
  and single-instance constraint make it an awkward fit.

### Option 4: Cloud Pub/Sub to client bridge

**Description**: The feed-engine publishes ticks to Cloud Pub/Sub; a bridge layer
delivers them to browsers (Pub/Sub has no browser-native subscriber, so this
still requires a server-side fan-out endpoint or SDK glue to reach clients).

**Technical Characteristics**:
- Pub/Sub as a server-to-server message backbone; topics per feed or per ISIN.
- A bridge service still terminates client connections (SSE/WS) because browsers
  cannot subscribe to Pub/Sub directly.
- At-least-once delivery and message ordering semantics must be reconciled with
  overwrite-in-place "latest tick wins".

**Advantages**:
- Strong server-side decoupling and durable buffering between producer and any
  number of server-side consumers.
- Scales server-to-server fan-out cleanly if many backend consumers ever appear.

**Disadvantages**:
- Does not actually reach the browser — still needs the very client bridge
  (SSE/WS) that Options 2/3 describe, so it adds a hop without removing the hard
  part.
- At-least-once + ordering is a poor match for "show only the latest price",
  adding dedup/sequence logic.
- Introduces a non-Firebase product and extra cost/latency for a single
  always-on producer with no backend consumer fan-out need.

**Risk Assessment**:
- **Technical Risk**: Medium. Adds delivery-semantics reconciliation on top of an
  unsolved last-hop.
- **Schedule Risk**: High. Builds a Pub/Sub layer *and* the client bridge it still
  requires.
- **Ecosystem Risk**: Medium. Pulls a separate GCP product into the otherwise
  Firebase-contained data plane for no client-facing benefit.

## Decision

Adopt **Option 1: the RTDB Tick Bus**. The `feed-engine` Cloud Run service is the
sole Admin-SDK writer of normalised ticks to public `/quotes/{isin}` nodes
(overwrite-in-place) and a single global `/feed/status`. Browser clients consume
those nodes via the Firebase Realtime Database SDK and never open a socket to
Cloud Run. SSE-over-fetch from Cloud Run (Option 2) is retained as the documented
escape hatch only.

The implementation will use:
- **Firebase Realtime Database** as the one-way tick bus: `/quotes/{isin}` written
  overwrite-in-place plus a global `/feed/status` for the live/delayed/reconnect
  banner.
- **Firebase Admin SDK in the feed-engine** as the *only* writer to those nodes.
- **The Firebase RTDB client SDK** in `apps/web`, with `onValue` listeners gated
  to the ISINs in the user's inventory, hydrating the two-tier hot/cold state that
  the rAF handover loop renders.
- **Security rules** to enforce the privacy plane: any signed-in user may read
  `/quotes` and `/feed/status`; no client may write them; private holdings remain
  uid-scoped in Firestore (ADR-0004).
- **The `data-contracts` Tick/feed-status shapes** (ADR-0006) as the only payload
  crossing the bus — never source-specific framing.

## Consequences

### Positive

1. **Auth, fan-out, reconnect, and offline cache inherited**: all come from the
   managed Firebase stack; no hand-rolled socket auth or reconnection.
2. **Cloud Run cap sidestepped**: clients never connect to Cloud Run, so the
   60-minute connection limit is irrelevant to client liveness.
3. **Feed-engine stays single-minded**: client load never touches the
   concurrency-1 oracle process; producing ticks and serving them are decoupled.
4. **Declarative privacy plane**: the public-quotes / private-holdings boundary
   lives in security rules, consistent with the Firestore book (ADR-0004).
5. **Presence-gated economy**: a tab subscribes only to the `/quotes/{isin}` nodes
   it holds, so idle/unheld instruments cost nothing client-side.

### Negative

1. **Write-amplified hot path**: every tick is an RTDB write plus a managed
   fan-out, billed on volume; a busy book at full market speed drives RTDB
   egress/write cost and can hit RTDB write-rate throttling on hot ISINs.
2. **Liveness coupled to RTDB**: client-perceived latency and consistency now
   depend on RTDB's characteristics rather than a direct producer→consumer socket,
   adding one managed hop between tick and pixel.
3. **JSON-only, latest-only shape**: overwrite-in-place discards intra-interval
   ticks and forbids binary/structured framing; anything richer than "latest tick"
   does not survive the bus.
4. **Second live-path datastore**: RTDB joins Firestore as load-bearing, so an
   RTDB outage or rules regression directly darkens live prices.
5. **Hard to reverse**: client SDK listeners, the rules-based privacy plane, and
   the handover motion code are all written against this bus; switching transports
   means rewriting both ends and re-deriving the auth story.

### Neutral

1. **Escape hatch documented, not built**: SSE-over-fetch from Cloud Run remains
   the sanctioned fallback if RTDB ever proves insufficient, with the cost of
   building the bespoke layer deferred until actually needed.
2. **Status as data**: `/feed/status` makes live/delayed/reconnect/market-closed a
   read of a normal node rather than a transport-level signal.
3. **One writer invariant**: making the feed-engine the sole writer is a
   convention the rules enforce, not a property of RTDB itself.

## Decision Outcome

The objectives are met: signed-in-only reads, multi-tab fan-out, reconnection,
and offline cache come from Firebase with no bespoke socket code (drivers 1–2);
clients never touch Cloud Run, so the 60-minute cap cannot drop a session
(driver 3); the feed-engine keeps holding both source sockets and running the
in-memory oracle without serving client connections (driver 4); and the
public-quotes / private-holdings boundary stays in declarative security rules
alongside the Firestore book (driver 5). Only normalised `data-contracts` ticks
cross the bus, honouring the server-side-only-internals rule (secondary driver 1).

Mitigations:
- **Write amplification / RTDB throttling**: overwrite-in-place keeps each ISIN at
  a single latest-tick node; the feed-engine coalesces bursts to a bounded
  per-ISIN write cadence rather than forwarding every raw frame, capping write
  rate and cost.
- **Liveness coupled to RTDB**: `/feed/status` plus the freshness enum surface
  delayed/reconnect states in the UI so a slow or degraded bus is shown, never
  silently stale; the rAF handover renders the freshness banner directly.
- **JSON/latest-only shape**: this matches L&S's no-history reality (Appendix A);
  the hot/cold model and sparkline accumulate history client-side from the tick
  stream, not from the bus.
- **Second live-path datastore / reversibility**: the SSE-over-fetch escape hatch
  is documented so a transport swap has a defined target; the `data-contracts`
  seam (ADR-0006) means a swap changes the delivery mechanism, not the payload
  contract, limiting blast radius to the transport edges.

## Related Decisions

- [ADR-0002: Runtime Classes](0002-three-runtime-classes-execution-model.md) - establishes why a persistent producer must be Cloud Run, not a Function.
- [ADR-0003: Feed-Engine Single Always-On Service](0003-feed-engine-single-process-singleton.md) - the single concurrency-1 producer this transport keeps client-free.
- [ADR-0004: Two-Store Datastore Split](0004-datastore-split-firestore-book-rtdb-wire.md) - defines RTDB as the wire and the public/private privacy boundary this transport relies on.
- [ADR-0006: Shared Tick Contract](0006-tick-schema-and-source-adapter-contract.md) - the only payload shape allowed to cross the bus.
- [ADR-0007: ISIN as Canonical Identity](0007-isin-resolution-llm-proposes-resolver-disposes.md) - `/quotes/{isin}` keys the bus on the canonical join key.

## Links

- [cancri Implementation Brief](../../design/IMPLEMENTATION_BRIEF.md) - sections C (live data layer), F (realtime UI), and 3 (governance/security).
- [cancri Implementation Brief, Appendix A — L&S](../../design/IMPLEMENTATION_BRIEF.md) - L&S sends only the latest tick, no history (motivates overwrite-in-place).
- [cancri Implementation Brief, Appendix B — Yahoo](../../design/IMPLEMENTATION_BRIEF.md) - delayed fallback / sanity oracle whose freshness is surfaced via `/feed/status`.

## More Information

- **Date:** 2026-06-27
- **Source:** cancri decomposition pass; cross-cutting decisions 1–6.
- **Related ADRs:** ADR-0002, ADR-0003, ADR-0004, ADR-0006, ADR-0007.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created, awaiting implementation.

**Action Required:** Implement decision and audit.
