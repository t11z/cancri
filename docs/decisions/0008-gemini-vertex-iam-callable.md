---
title: "Gemini via Vertex AI From a Callable Function (IAM)"
description: "Inventory normalisation calls Vertex AI Gemini from a 2nd-gen Callable Function authenticated by the runtime service account, with no API key anywhere."
type: adr
category: security
tags: [gemini, vertex-ai, iam, callable-function, app-check, secrets]
status: accepted
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [vertex-ai, gemini-3.5-flash, firebase-functions, app-check, iam]
---

# ADR-0008: Gemini via Vertex AI From a Callable Function (IAM)

## Status

Accepted

## Context

### Background and Problem Statement

cancri's onboarding pipeline (brief §B) converts messy user input — chat text,
CSV, Excel, pasted raw text — into a structured asset inventory on a fixed schema:
original free-text name, resolved instrument identity (ISIN/symbol), quantity,
optional cost basis, and a confidence signal. That transformation is the job of an
LLM. The platform section of the brief (§1) fixes two hard constraints that bound
the design space sharply: the **LLM is Gemini**, and **data stays inside the
Firebase project**. The governance section (§3) adds a third: **no secrets in the
client** — all key-touching Gemini calls run server-side. These are not
preferences; they are the frame the decision must fit inside.

The question this ADR settles is the *transport and trust shape* of the Gemini
call: which Gemini surface (AI Studio API vs Vertex AI in-project vs client-side
Firebase AI Logic), how it authenticates (an API key string vs IAM identity), and
which Function class invokes it (Callable vs raw HTTPS). Because cancri is a
Firebase-hosted, access-gated, read-only terminal, the normalisation endpoint is
also a privileged write path: its output is persisted as the user's durable book
in Firestore (ADR-0004). An unauthenticated or weakly-authenticated normalisation
endpoint is therefore both a data-integrity hole and a cost-abuse vector against a
paid LLM.

This is hard to reverse — *medium* reversibility — for three compounding reasons.
First, it **pins a provider surface**: Vertex AI in-project and the AI Studio
Gemini API are different endpoints with different SDK initialisation, different IAM
vs key auth models, and different request/response plumbing; switching later is a
server-code migration plus a data-residency re-review, not a config flip. Second,
it **pins a data-residency posture**: choosing Vertex AI in-project is the concrete
mechanism by which the brief's "data stays inside the Firebase/GCP project" promise
is *kept*, and once users have onboarded portfolios under that promise, weakening
it is a trust regression, not a refactor. Third, it **pins a model id**
(`gemini-3.5-flash`) into the structured-output contract, so the normalisation
prompt, schema, and confidence calibration are tuned against a specific model
generation. The choice is recoverable, but only by deliberate, reviewed work.

### Current Limitations

1. There is no normalisation backend yet; the brief names "Gemini" but does not
   pick a Gemini *surface*, an auth model, or a Function class.
2. The naive path — an AI Studio API key — is a long-lived secret that must live
   somewhere, be rotated, and routes request data through a surface outside the
   project's IAM boundary, colliding with both the data-residency and
   no-client-secrets constraints.
3. Without a verified caller identity on the endpoint, the persisted-inventory
   write path (ADR-0004) cannot bind normalisation output to a `uid`, and the paid
   LLM endpoint is exposed to anonymous abuse.

## Decision Drivers

### Primary Decision Drivers

1. **Data stays inside the project (brief §1)**: The decisive constraint. Vertex AI
   invoked in-project keeps inventory text on Google Cloud infrastructure under the
   project's own IAM, satisfying the residency promise without an external hop.
2. **No secrets in the client, none to rotate (brief §3)**: The runtime service
   account is an *identity*, not a string. There is zero key material to embed,
   leak, store in Secret Manager, or rotate — the strongest possible reading of
   "no secrets."
3. **Verified caller identity binds to the book**: A 2nd-gen Callable Function
   delivers a verified Firebase Auth `uid` in `request.auth`, so normalisation
   output can be written to the correct user's Firestore book (ADR-0004) and the
   paid endpoint is not anonymously callable.
4. **App Check gateability**: Callable Functions integrate App Check, so the
   endpoint can require an attested app instance, throttling automated abuse of a
   metered LLM in a read-only product with no other write surface.

### Secondary Decision Drivers

1. **Deterministic structured output**: Pinning `gemini-3.5-flash` with structured
   output yields the fixed inventory schema the propose/approve confirm screen
   (brief §B) depends on, instead of free-form text the server must re-parse.
2. **Firebase-only topology fit**: A Callable Function is the request-scoped runtime
   class already chosen for short, stateless work in ADR-0002; normalisation is
   exactly that shape (no socket, no long poll), so it needs no new runtime class.
3. **Cost posture for a single-tenant-ish terminal**: `gemini-3.5-flash` is the
   low-cost, low-latency tier appropriate for short normalisation turns rather than
   a frontier reasoning model.
4. **Operational simplicity**: IAM-scoped service-account access removes an entire
   secret-lifecycle workstream (issuance, storage, rotation, revocation, audit).

## Considered Options

### Option 1: Vertex AI in-project + IAM + Callable Function, model pinned to gemini-3.5-flash

**Description**: Normalisation runs in a 2nd-gen Firebase Callable Function. The
Function initialises the Vertex AI SDK against the project's own region and calls
`gemini-3.5-flash` with a structured-output schema. Authentication to Vertex is the
Function's runtime **service account** via IAM (the SA is granted the Vertex AI User
role); authentication of the *caller* is the verified Firebase Auth `uid` carried by
the Callable, optionally gated by App Check. No API key exists anywhere in the system.

**Technical Characteristics**:
- 2nd-gen Callable Function (request-scoped runtime, ADR-0002); no socket, fits the
  Function constraint exactly.
- Vertex AI invoked in-project/in-region → request data stays inside the GCP/Firebase
  trust boundary.
- Auth to the model = IAM role on the runtime SA; auth of the user = `request.auth.uid`;
  abuse control = App Check attestation.
- Output = `gemini-3.5-flash` structured output bound to the fixed inventory schema
  (free-text name, ISIN/symbol, quantity, optional cost basis, confidence).
- On ambiguity the Function returns a clarify signal rather than guessing (brief §B).

**Advantages**:
- Satisfies "data stays in the project" and "no secrets in the client" with **zero key
  material** — IAM, not a string; nothing to rotate or leak.
- Verified `uid` lets normalisation output write the correct user's Firestore book
  (ADR-0004); App Check throttles anonymous abuse of a paid endpoint.
- Reuses an existing runtime class (ADR-0002); no new infrastructure.
- Structured output yields the exact schema the confirm screen consumes.

**Disadvantages**:
- Pins a provider surface (Vertex in-project), a residency posture, and a model id —
  medium reversibility; a later move to a different Gemini surface is a server
  migration plus a residency re-review.
- Vertex AI in-project has a heavier IAM/role setup than dropping in an API key.
- Couples the project to Vertex regional availability and quota for `gemini-3.5-flash`.

**Risk Assessment**:
- **Technical Risk**: Low. Callable + Vertex SDK + service-account IAM is a
  well-trodden, first-party Firebase/GCP path.
- **Schedule Risk**: Low. No bespoke secret plumbing; mostly IAM role grants and SDK
  wiring.
- **Ecosystem Risk**: Medium. Bound to Vertex regional/quota availability and to one
  model generation; provider migration is real but recoverable work.

### Option 2: AI Studio Gemini API key stored in Secret Manager

**Description**: Use the AI Studio Gemini API (the `generativelanguage` endpoint)
with a long-lived API key. The key is held in Secret Manager and injected into the
Function at runtime, keeping it off the client but still present as a managed secret.

**Technical Characteristics**:
- Long-lived API key string is the credential; Secret Manager handles storage and
  versioning.
- Request data egresses to the AI Studio surface, which is **outside** the project's
  IAM boundary even though the key is managed.
- Function still needs caller auth bolted on separately (Callable or manual token
  check).

**Advantages**:
- Fastest possible start: drop a key in, call the endpoint, done.
- Secret Manager gives versioning, access logging, and rotation hooks.
- AI Studio surface is simple and widely documented.

**Disadvantages**:
- Reintroduces a **secret to rotate** — exactly the lifecycle the chosen option
  eliminates — and a key, however managed, can leak.
- Routes inventory text through a surface outside the project boundary, weakening the
  brief's "data stays inside the Firebase project" promise.
- "No secrets in the client" is satisfied only at the storage layer; the architectural
  *intent* (no key material at all) is not.

**Risk Assessment**:
- **Technical Risk**: Low. Trivial to implement.
- **Schedule Risk**: Low. Least up-front effort of any option.
- **Ecosystem Risk**: High. Data-residency posture is weaker than the brief asks; an
  audit could flag the external surface and force a later migration to Vertex anyway.

### Option 3: Firebase AI Logic / client-side Vertex

**Description**: Use Firebase AI Logic (client SDK) to call Vertex/Gemini directly
from the browser, with App Check as the abuse gate, removing the server hop entirely.

**Technical Characteristics**:
- LLM call originates in the vanilla-TS client; no normalisation Function in the path.
- App Check is the primary control; no server-side `uid`-bound write step before the
  model call.
- Inventory normalisation logic and prompt live in shipped client code.

**Advantages**:
- Lowest latency and least backend to build; no Function to deploy for normalisation.
- First-party Firebase integration with App Check support.
- Scales trivially with the client.

**Disadvantages**:
- **Defeats the server-side-secrets rule (brief §3)** in spirit: key-touching Gemini
  calls are mandated server-side, and this moves the model call to the client.
- The normalisation prompt/schema and any model behaviour become client-inspectable
  and client-tamperable; a hostile client can bypass it before the Firestore write.
- No server seam to enforce the persisted-book contract (ADR-0004) or to centralise
  audit before adoption.

**Risk Assessment**:
- **Technical Risk**: Medium. App-Check-only protection of a paid model from the
  client is a weaker trust boundary.
- **Schedule Risk**: Low. Least backend work.
- **Ecosystem Risk**: High. Conflicts directly with the brief's server-side mandate;
  effectively disqualifying for cancri.

### Option 4: Raw HTTPS Function calling Vertex AI

**Description**: Keep Vertex AI in-project with service-account IAM (residency and
no-key benefits intact), but expose it through a raw `onRequest` HTTPS Function
instead of a Callable.

**Technical Characteristics**:
- Same in-project Vertex + IAM model surface as Option 1.
- Raw HTTPS endpoint: no automatic Firebase Auth context, no built-in App Check
  integration — both must be implemented by hand (verify ID token, verify App Check
  token).
- Manual CORS, manual request/response envelope.

**Advantages**:
- Retains the residency and no-key advantages of in-project Vertex.
- Maximum control over the HTTP contract; callable from non-Firebase clients if ever
  needed (not a cancri requirement).

**Disadvantages**:
- **Loses the verified Auth context and App Check that come free with Callable** —
  precisely the two controls that bind normalisation to a `uid` and throttle abuse.
- Re-implements token verification by hand: more code, more ways to get auth subtly
  wrong on a privileged write path.
- No upside over Callable for cancri, which has only a first-party Firebase client.

**Risk Assessment**:
- **Technical Risk**: Medium. Hand-rolled auth on a privileged endpoint is an
  error-prone surface.
- **Schedule Risk**: Medium. More plumbing than Callable for strictly less safety.
- **Ecosystem Risk**: Low. Same provider/residency posture as Option 1.

## Decision

Adopt **Option 1**: inventory normalisation calls **Vertex AI Gemini
(`gemini-3.5-flash`, structured output) from a 2nd-gen Callable Function
authenticated by the runtime service account**, with no API key anywhere in the
system.

The implementation will use:
- **A 2nd-gen Firebase Callable Function** (`functions/`) as the normalisation
  endpoint — request-scoped per ADR-0002 — carrying the verified `request.auth.uid`
  and gated by **App Check**.
- **Vertex AI in-project**, with the Function's **runtime service account** granted
  the Vertex AI User IAM role; authentication is IAM identity, not a key string.
- **`gemini-3.5-flash` with a structured-output schema** bound to the fixed inventory
  shape from the `data-contracts` package (ADR-0006) — free-text name, resolved
  ISIN/symbol (ISIN is the canonical key, ADR-0007), quantity, optional cost basis,
  and a confidence signal; ambiguity returns a clarify signal rather than a guess.
- **Firestore as the durable sink** (ADR-0004): normalisation output is written
  under the verified `uid` only after the user approves it on the confirm screen.

## Consequences

### Positive

1. **Zero key material**: No API key to embed, store, rotate, or leak — the
   "no secrets in the client" rule is met at the strongest reading, as IAM identity.
2. **Residency promise kept concretely**: In-project Vertex keeps inventory text
   inside the GCP/Firebase trust boundary, honouring brief §1 by mechanism, not by
   policy text.
3. **Privileged write path is authenticated**: The verified `uid` plus App Check bind
   normalisation output to the right user's book (ADR-0004) and throttle anonymous
   abuse of a metered model.
4. **Schema-shaped output**: Structured output delivers the exact inventory schema the
   propose/approve confirm screen consumes, with no fragile server-side re-parsing.

### Negative

1. **Provider, residency, and model lock-in (medium reversibility)**: This pins the
   Vertex-in-project surface, the residency posture, and the `gemini-3.5-flash` id;
   moving to another Gemini surface or model generation is a server migration plus a
   residency and prompt/confidence re-review, not a config change.
2. **Heavier setup than a key**: Vertex IAM roles, regional enablement, and SDK wiring
   are more up-front configuration than dropping an API key into Secret Manager.
3. **Quota and regional coupling**: Availability and throughput depend on Vertex
   `gemini-3.5-flash` quota and regional presence in the chosen project region.
4. **Model-drift exposure**: A pinned model generation can be deprecated or behave
   differently across versions, requiring re-tuning of the prompt and confidence
   calibration.

### Neutral

1. **One more Callable in `functions/`**: Normalisation joins logo and instrument-search
   as request-scoped Functions (ADR-0002); no new runtime class is introduced.
2. **App Check becomes a cross-cutting requirement**: The same attestation gate is
   reusable across cancri's other callable endpoints.
3. **Confidence signal is advisory**: The model's confidence feeds the confirm screen
   but the user, not the model, makes the final adoption call (propose/approve, §3).

## Decision Outcome

The decision meets cancri's fixed platform objectives directly: Gemini is the LLM
(brief §1); Vertex-in-project keeps data inside the project (§1); IAM identity with no
key satisfies "no secrets in the client" at its strongest (§3); and the Callable's
verified `uid` plus App Check protect the privileged, paid normalisation endpoint that
feeds the durable Firestore book (ADR-0004). Structured `gemini-3.5-flash` output
delivers the fixed inventory schema the propose/approve flow requires.

Mitigations:
- **Lock-in / medium reversibility**: keep all Gemini access behind the single
  Callable seam and route inventory shapes through `data-contracts` (ADR-0006) so a
  future provider/surface swap touches one Function, not the client or the book schema.
- **Model drift**: pin the model id explicitly and treat a model-version bump as a
  reviewed change with a re-run of the normalisation regression against fixture inputs.
- **Quota/regional coupling**: select a region with `gemini-3.5-flash` availability and
  monitor quota; degraded normalisation surfaces as a clarify/error state, never a
  silent bad write.
- **Setup cost**: codify the SA role grants and Vertex enablement in infra-as-code so
  the IAM posture is reproducible and auditable.

## Related Decisions

- [ADR-0002: Runtime Classes](0002-three-runtime-classes-execution-model.md) - normalisation is the
  request-scoped Callable class; Functions cannot hold sockets, so this is the right
  home for a short LLM turn.
- [ADR-0004: Datastore Split](0004-datastore-split-firestore-book-rtdb-wire.md) - normalisation output is the
  durable per-user book written to Firestore under the verified `uid`.
- [ADR-0006: Tick / Data Contracts](0006-tick-schema-and-source-adapter-contract.md) - the inventory schema the
  structured output is bound to lives in the shared `data-contracts` package.
- [ADR-0007: ISIN Canonical Identity](0007-isin-resolution-llm-proposes-resolver-disposes.md) - normalisation
  resolves free text to ISIN, the canonical join key consumed downstream.

## Links

- `design/IMPLEMENTATION_BRIEF.md` §1 Platform (Gemini fixed; data stays in project),
  §B Portfolio onboarding pipeline (normalisation schema, identity resolution,
  propose/approve), §3 Governance & security (no secrets in the client).
- `design/IMPLEMENTATION_BRIEF.md` Appendix A (L&S ISIN→instrument-id context) and
  Appendix B (Yahoo) — downstream of the ISIN the normaliser resolves.

## More Information

- **Date:** 2026-06-27
- **Source:** cancri implementation brief (§1, §B, §3) and the cross-cutting
  architecture decomposition (decision 4: Gemini = Callable invoking Vertex AI via
  service-account IAM, no API key).
- **Related ADRs:** ADR-0002, ADR-0004, ADR-0006, ADR-0007.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created, awaiting implementation.

**Action Required:** Implement decision and audit.
