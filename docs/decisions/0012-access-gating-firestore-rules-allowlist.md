---
title: "Access Gating via a Firestore-Rules Invite Allowlist"
description: "Authenticating with Google is not authorisation; an /allowlist/{email} document checked in Firestore security rules decides who may mount a book."
type: adr
category: security
tags: [auth, firebase-auth, firestore, security-rules, access-control]
status: accepted
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [firebase-auth, firestore, firestore-security-rules]
related: [0004-datastore-split-firestore-book-rtdb-wire.md]
---

# ADR-0012: Access Gating via a Firestore-Rules Invite Allowlist

## Status

Accepted

## Context

### Background and Problem Statement

cancri is an **access-gated, per-user** live-portfolio terminal: each user sees only
their own book, and the brief frames the product as invite-only rather than open to the
public. Phase 2 wired Firebase Auth with two sign-in paths — email/passphrase
(auto-registering on first use) and Google. The email/passphrase path let *anyone* who
typed an address and password register and mount an (empty) book, which is open
self-registration — the opposite of "access-gated". The code itself flagged the real
invite policy as "a later decision".

Two things forced that decision now. First, the deployed project had Firebase Auth
unprovisioned, so every sign-in failed (`CONFIGURATION_NOT_FOUND`); fixing that and
removing the open email/passphrase path (leaving Google-only) makes the gating question
unavoidable, because once Auth works, *any* Google account would otherwise be admitted.
Second, "authenticated" must stop meaning "authorised": we need a membership boundary
that decides which authenticated identities may actually use the terminal.

The privacy boundary is already settled (ADR-0004): the sensitive data — the book — lives
in Firestore under `/users/{uid}/*`, gated so only its owner can read it; the Realtime
Database holds only public quotes and feed status, readable by any signed-in user. So the
*authorisation* boundary that matters is the one in front of the Firestore book.

This decision pins an invariant (who may hold a book) across three layers — auth, security
rules, and the client gate screen — and so warrants an ADR.

### Current Limitations

1. With Auth provisioned and no allowlist, any Google account is admitted and can
   read/write its own `/users/{uid}` subtree — the product is not actually gated.
2. The removed email/passphrase path auto-registered arbitrary identities, contradicting
   the access-gated intent.
3. There is no place to express "this identity is invited" that the security rules can
   enforce; client-only checks are trivially bypassable.

## Decision Drivers

### Primary Decision Drivers

1. **Enforcement must live in the datastore rules**, not the client. The brief makes
   security-rules the enforcement surface (ADR-0004, §5); a gate that the client alone
   applies is cosmetic, since a determined user can call Firestore directly.
2. **Lowest new infrastructure for a small, owner-managed list.** This is a personal /
   invite terminal with a tiny membership set; the mechanism should not require new
   runtime components, a platform upgrade, or a deploy to add a member.
3. **Single, sensitive boundary.** The only private data is the Firestore book; gating
   *its* rules is sufficient for the real boundary. Quotes are public-to-signed-in by
   design (ADR-0004) and need no per-identity gating.

### Secondary Decision Drivers

1. **Honest client UX.** The client should be able to tell an invited from an
   uninvited user to show a clear "access pending" screen rather than a broken book —
   without weakening the server-side rule.
2. **Auditable, reversible membership.** Adding/removing a member should be a single,
   visible data change (a document), not a code change or claim-propagation dance.
3. **Composes with the existing rules model.** ADR-0004 already gates `/users/{uid}` on
   `request.auth.uid`; the allowlist should slot in as an additional predicate, not a
   rewrite.

## Considered Options

### Option 1: Firestore-rules allowlist document (`/allowlist/{email}`)

**Description**: Maintain an `/allowlist/{email}` collection whose document IDs are
invited (lowercased, verified) emails. Firestore rules gate every `/users/{uid}` access
on `exists(/allowlist/$(request.auth.token.email))` in addition to the existing uid
match. A signed-in user may read only their own allowlist entry, which drives a client
"not invited" gate. Membership is managed out-of-band (Firebase console / admin); no
client write rule exists.

**Technical Characteristics**:
- Enforcement entirely in `config/firestore.rules`; one helper, `isAllowlisted()`.
- Also requires `request.auth.token.email_verified == true` (always true for Google).
- Owner adds/removes a document to grant/revoke; effect is immediate, no deploy.
- Client reads `/allowlist/{ownEmail}` to branch between terminal and gate screen.
- RTDB quotes remain gated only by `auth != null` (public-to-signed-in, ADR-0004).

**Advantages**:
- Zero new runtime infrastructure — no functions, no platform upgrade.
- Membership is plain data: visible, auditable, instantly reversible from the console.
- Slots into the existing uid-gated rule as one extra predicate.
- Gates the only sensitive store (the book); client gate is exact, not a guess.

**Disadvantages**:
- An `exists()` lookup adds a document read to each rules evaluation on the book.
- Enforcement is per-store: it does not, by itself, gate RTDB (acceptable, as quotes
  are public-to-signed-in by design).
- Uninvited users can still authenticate and obtain a session (they just see nothing).
- Email-keyed membership assumes a stable, verified email claim (true for Google).

**Risk Assessment**:
- **Technical Risk**: Low. `exists()`-gated rules are a standard Firestore pattern; the
  change is small and unit-testable against the emulator.
- **Schedule Risk**: Low. Rules edit + a client check + one screen; no infra to stand up.
- **Ecosystem Risk**: Low. Uses only first-party Firestore rules already in the project.

### Option 2: Custom claim `approved`, set by a Cloud Function

**Description**: A Cloud Function sets a custom claim `approved: true` on invited users
(triggered by an allowlist write or admin action). Both Firestore *and* RTDB rules gate
on `request.auth.token.approved == true`, giving one uniform token across both stores.

**Technical Characteristics**:
- Requires a deployed Function with the Admin SDK to set claims.
- Claims propagate on token refresh; the client must force `getIdToken(true)`.
- One predicate gates both stores uniformly.

**Advantages**:
- Uniform gating across Firestore and RTDB from a single token.
- No per-evaluation `exists()` read; the claim travels in the auth token.

**Disadvantages**:
- Adds a runtime component (a Function) and its deploy/maintenance surface.
- Claim propagation has timing seams (stale token until refresh) that complicate the
  first-load gate.
- Revocation lags until the token expires/refreshes — membership is less crisp than data.

**Risk Assessment**:
- **Technical Risk**: Medium. Correct claim propagation and revocation timing are easy to
  get subtly wrong.
- **Schedule Risk**: Medium. Requires building, deploying, and testing a Function.
- **Ecosystem Risk**: Low. Custom claims are first-party, but add moving parts.

### Option 3: Auth blocking function (`beforeSignIn`)

**Description**: A blocking function rejects sign-in for non-allowlisted emails, so
uninvited users cannot authenticate at all.

**Technical Characteristics**:
- Requires upgrading the project to Identity Platform (GCIP).
- Hard-blocks at the authentication step; no session is ever issued.

**Advantages**:
- Strongest gate — uninvited users never obtain a session.
- No data leaks of any kind, since authentication itself fails.

**Disadvantages**:
- Requires a platform upgrade (GCIP) and the associated infrastructure/dependency.
- Heavier than the threat model for a small invite terminal warrants.
- Couples the access policy to a blocking-function runtime.

**Risk Assessment**:
- **Technical Risk**: Medium. Blocking functions plus a platform upgrade enlarge the
  surface for a modest gain.
- **Schedule Risk**: Medium. GCIP enablement and a deployed blocking function.
- **Ecosystem Risk**: Medium. Adds a GCIP dependency beyond the base Firebase setup.

### Option 4: No allowlist (status quo)

**Description**: Any authenticated Google account mounts its own book; per-user isolation
(ADR-0004) is the only boundary.

**Advantages**:
- Nothing to build; simplest possible.

**Disadvantages**:
- The product is not access-gated, contradicting the brief's core framing.

**Disqualifying Factor**: Fails the access-gated requirement outright.

## Decision

Adopt **Option 1**: gate access with a **Firestore-rules invite allowlist**.

The implementation will use:
- **`/allowlist/{email}`** documents, keyed by the invited user's lowercased, verified
  email, as the single source of membership truth. Membership is managed out-of-band
  (Firebase console / admin); there is no client write rule.
- **`config/firestore.rules`** as the enforcement point: a helper `isAllowlisted()`
  requires `request.auth.token.email_verified == true` and
  `exists(/allowlist/$(request.auth.token.email))`, and every `/users/{uid}` read/write
  additionally requires it alongside the existing `signedInAs(uid)` predicate.
- A **self-read rule** on `/allowlist/{email}` (a signed-in user may read only their own
  entry) so the client can branch.
- A **client gate**: `isAllowlisted(db, email)` in `apps/web/src/persistence.ts`, checked
  in the app's signed-in routing; non-members are routed to a "not on the allowlist /
  access pending" screen (`apps/web/src/screens/denied.ts`) with a sign-out action,
  instead of onboard/live.

Authenticating remains open (any Google account can sign in and obtain a session), but
**authorisation** — mounting a book — is gated by the allowlist. RTDB quotes stay
public-to-signed-in (ADR-0004) and are intentionally not gated per identity.

## Consequences

### Positive

1. **Real, server-enforced gating**: the boundary lives in the security rules, so it
   cannot be bypassed by calling Firestore directly.
2. **Membership is plain, auditable data**: invite/revoke is a single console document
   change, effective immediately, with no deploy and no claim-propagation lag.
3. **Minimal surface**: no new runtime components or platform upgrade; the rule is one
   extra predicate on the already-uid-gated book.
4. **Honest UX**: the self-read rule lets the client show an exact "access pending" gate
   rather than a broken or empty terminal.

### Negative

1. **Per-evaluation read cost**: each book access incurs an `exists()` lookup against the
   allowlist document.
2. **Session without authorisation**: uninvited users can still sign in and hold a session;
   they simply cannot read any book. (Defensible — the only private data is fully denied.)
3. **Per-store enforcement**: the allowlist gates Firestore only; RTDB relies on its own
   public-to-signed-in rule. A future need to gate quotes per identity would require a
   different mechanism (and likely a superseding ADR).
4. **Email-keyed membership**: depends on a stable, verified email claim; correct for
   Google, but a different provider without verified email would need rework.

### Neutral

1. **Google-only sign-in**: removing the email/passphrase path is a related change, not a
   property of this decision; the allowlist would work with any verified-email provider.
2. **Out-of-band management**: membership is curated by the operator in the console; no
   in-app admin surface is introduced here.

## Decision Outcome

The access-gated requirement is met by enforcing membership where it cannot be bypassed —
the Firestore rules in front of the book — while keeping membership itself as cheap,
visible, reversible data. The client gate is exact because rules permit a self-read of the
allowlist entry, so users see an honest "access pending" state rather than a failure. No
new runtime infrastructure is introduced.

Mitigations:
- **Per-evaluation read cost**: the cost is one document read on book access only; the
  book is low-traffic (read on session load, written on confirmation), so the overhead is
  negligible.
- **Session-without-authorisation**: rely on ADR-0004's deny-by-default — an uninvited
  session can read nothing under `/users/{uid}`; the client surfaces the gate explicitly.
- **Per-store / email-keyed limits**: documented here; revisit with a superseding ADR
  (custom claim or blocking function) only if quotes ever need per-identity gating or a
  non-verified-email provider is added.

## Related Decisions

- [ADR-0004: Datastore Split](0004-datastore-split-firestore-book-rtdb-wire.md) - establishes
  that the private book is the Firestore `/users/{uid}` subtree (the surface this allowlist
  gates) and that RTDB quotes are public-to-signed-in (intentionally not gated here).

## Links

- cancri Implementation Brief — access-gated, per-user framing; security-rules as the
  enforcement surface.
- `SETUP.md` §4a — provisioning step that enables Firebase Auth + Google and notes the
  invite-allowlist policy as the access-gating decision.

## More Information

- **Date:** 2026-06-27
- **Source:** Auth provisioning fix (CONFIGURATION_NOT_FOUND) + Google-only consolidation;
  the deferred invite-allowlist policy decided here.
- **Related ADRs:** ADR-0004.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created alongside implementation (firestore.rules allowlist gate, client
gate screen, Google-only auth). Audit to confirm rules + client wiring on next review.

**Action Required:** Audit the deployed rules and client gate end-to-end.
