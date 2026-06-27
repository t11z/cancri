---
title: "Holdings Intake Is Always-Available and Merges Into the Book, User-Resolved"
description: "The Gemini intake is reachable at any time, not only when the book is empty, and confirming it merges proposed holdings into the existing book on canonical identity with per-instrument user-resolved conflicts."
type: adr
category: architecture
tags: [onboarding, intake, inventory, merge, firestore, governance]
status: accepted
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [firebase-functions, firestore, vanilla-ts, gemini-3.5-flash]
related: [0004-datastore-split-firestore-book-rtdb-wire.md, 0007-isin-resolution-llm-proposes-resolver-disposes.md, 0008-gemini-vertex-iam-callable.md]
---

# ADR-0013: Holdings Intake Is Always-Available and Merges Into the Book, User-Resolved

## Status

Accepted

## Context

### Background and Problem Statement

The Gemini-backed intake (brief §B) was built as a one-shot **onboarding** step.
It was reachable only when a user's book was empty: `enterSignedIn` in
`apps/web/src/app.ts` routes a signed-in, allowlisted user to the dashboard when a
book exists, and to the intake screen otherwise. The confirm step then persisted
the book with a **full overwrite** — `confirmInventory` in `functions/src/index.ts`
did `.doc(users/{uid}/inventory/current).set({ positions })`, replacing the entire
book wholesale.

Two consequences fall straight out of that shape. First, a user could **never add
instruments after the first run**: once a book existed there was no path back to the
intake, so the only way to grow a portfolio was to have entered everything at
onboarding. Second, even if the intake were re-entered, confirm would **clobber**
the existing book rather than extend it. Together these make cancri a *write-once
book*, which directly contradicts the product premise — "a terminal you leave open"
that reflects the user's actual, **evolving** portfolio. A living portfolio gains
and sheds positions over time; the intake must serve that lifecycle, not just its
first moment.

The question this ADR settles is the *lifecycle and write semantics* of holdings
intake: when the intake is reachable, and what "confirm" does to a book that already
has positions. Because confirm is the privileged write path to the durable Firestore
book (ADR-0004, ADR-0008), the answer also has to preserve the server's role as the
re-validating authority and the brief's "machine proposes, user disposes" governance
(§3) — it cannot bake a silent merge policy into the server.

This is *medium* reversibility. It pins an **invariant** about how the durable book
is mutated (identity-keyed, user-resolved merge rather than overwrite) that the
dashboard, the confirm screen, and any future edit surface all rely on. It does not
change the book *schema* (ADR-0004) — a deliberate constraint below — so a later
revision is reviewed work on the merge and confirm seams, not a data migration.

### Current Limitations

1. The intake is gated to the empty-book case only; there is no affordance to open it
   again once a user has confirmed a book.
2. `confirmInventory` overwrites the whole book on `.set`, so a re-run would discard
   every previously confirmed position rather than extend the book.
3. There is no notion of an instrument *already in the book*: nothing detects that a
   proposed holding collides with an existing one, so neither a merge nor a
   user-facing conflict choice exists.

## Decision Drivers

### Primary Decision Drivers

1. **The terminal must reflect a living portfolio**: positions are added and extended
   over the life of the book; a write-once intake contradicts "a terminal you leave
   open." The intake has to be the lifecycle tool, not an onboarding gate.
2. **Machine proposes, user disposes (brief §B / §3)**: when a proposed holding
   collides with one already in the book, the *human* decides the outcome per
   instrument. No silent auto-merge policy may be baked into the server.
3. **Server stays the re-validating authority (ADR-0004, ADR-0008)**: the privileged
   write path must continue to validate every persisted position. The merge may be
   computed client-side, but the server validates the complete book it is handed.
4. **Minimal, reviewable change**: no schema change to the book; the merge is a pure,
   unit-tested function, and the server `.set` of a complete book is unchanged in
   mechanism.

### Secondary Decision Drivers

1. **One intake path, not two**: first-run and every later addition flow through the
   same screen and the same identity resolution / confidence flagging, so there is no
   parallel surface to keep in sync.
2. **Canonical identity already exists (ADR-0007)**: matching proposed against
   existing holdings reuses the ISIN-when-present-else-symbol key the rest of the
   system already joins on, rather than inventing a new match rule.
3. **Confidence and clarify already flow through confirm (ADR-0008)**: per-row user
   decisions are a natural extension of the propose/approve confirm screen, not a new
   interaction model.

## Considered Options

### Option 1: Always-available intake + user-resolved client-side merge, server persists the complete validated book

**Description**: The intake screen is reachable at any time. A "+ add" affordance on
the dashboard header and the existing empty-state "feed the terminal" button both
open the **same** intake screen; onboarding is simply the special case of "add into
an empty book," and the UI never frames it as a separate "add later" concept.
Confirming an intake **merges** the proposed holdings into the existing book, matching
on canonical identity (ISIN when present, else symbol — ADR-0007). A new instrument
is appended; an instrument already in the book is a **conflict**, resolved by the user
per instrument on the confirm screen via a segmented choice: "replace" (take the new
position) or "+add" (sum the new quantity onto the existing one). The merge is a pure
client function (`mergeInventory` in `apps/web/src/inventory.ts`) taking the existing
book, the additions, and a per-key choice resolver; the confirm screen assembles the
complete intended book and hands it to `confirmInventory`, which validates every
position and persists the whole book.

**Technical Characteristics**:
- Single intake screen entered from both empty-state and dashboard "+ add"; routing
  in `app.ts` no longer gates the intake on an empty book.
- Match key = ISIN ?? symbol (ADR-0007); new → append, existing → conflict.
- `mergeInventory` is pure: `(existing, additions, resolve) → mergedBook`; no I/O,
  unit-testable in isolation.
- Confirm screen owns per-conflict choice state and produces the complete book.
- `confirmInventory` still `.set`s a complete book and re-validates every position —
  server mechanism unchanged (ADR-0004, ADR-0008).

**Advantages**:
- The book becomes a living document; one path serves first-run and every later add.
- The user controls conflict resolution per instrument — "user disposes" is honoured
  with no policy hidden in the server.
- Server remains the validating authority on the privileged write path; the `.set`
  contract is untouched.
- Merge logic is pure and unit-tested; no book schema change.

**Disadvantages**:
- The confirm screen carries more UI state (a choice per conflicting row).
- The client computes the merged book; the server validates but does not itself merge,
  so the merge rule lives in client code.
- Concurrent multi-device confirms are last-write-wins on the whole book.
- "replace" discards the prior position (including any cost basis) silently.

**Risk Assessment**:
- **Technical Risk**: Low. A pure merge function plus a per-row choice on an existing
  confirm screen; the write path is unchanged.
- **Schedule Risk**: Low. No schema or server-mechanism change; bounded UI and one
  testable function.
- **Ecosystem Risk**: Low. Reuses ADR-0007 identity and the ADR-0008 confirm path; no
  new provider or contract.

### Option 2: Fixed server-side merge policy, no user choice

**Description**: Make the intake always-available, but resolve collisions with a fixed
server policy — always upsert-by-key (replace) or always sum — with no user decision.

**Technical Characteristics**:
- Merge rule lives in `confirmInventory`; the client sends only the additions.
- Collisions resolved deterministically by the server with no per-instrument input.

**Advantages**:
- Simplest confirm screen; no per-row state to manage.
- Merge authority is centralised on the server next to validation.

**Disadvantages**:
- Violates "user disposes" (brief §3): the human no longer picks the outcome.
- A fixed policy is wrong half the time — *always-sum* double-counts on an accidental
  re-import of the same CSV; *always-replace* silently drops the user's intent to add.
- The single correct behaviour is genuinely ambiguous per instrument, which is exactly
  why it should be a user choice, not a constant.

**Risk Assessment**:
- **Technical Risk**: Low. Trivial to implement.
- **Schedule Risk**: Low. Least UI work.
- **Ecosystem Risk**: High. Conflicts with the brief's governance model; a wrong
  policy corrupts portfolio value silently, which is a trust regression in a product
  that must be honest about its data.

### Option 3: Append-only, duplicates allowed (no merge)

**Description**: Make the intake always-available and simply append every proposed
holding to the book, allowing duplicate entries for the same instrument.

**Technical Characteristics**:
- No identity matching at confirm; positions list grows unconditionally.

**Advantages**:
- Trivially simple; no merge, no conflict UI, no choice state.

**Disadvantages**:
- Produces duplicate dashboard rows for the same instrument.
- Double-counts portfolio value — the terminal stops being honest about the book.
- Pushes de-duplication onto the user with no tool to do it.

**Risk Assessment**:
- **Technical Risk**: Low. Nothing to build.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: High. Directly produces wrong totals on a read-only terminal
  whose whole value is being trustworthy about the book.

### Option 4: Keep one-shot onboarding + a separate "edit book" CRUD surface

**Description**: Leave onboarding as the empty-book one-shot, and add a distinct
manual CRUD screen for editing the book afterwards.

**Technical Characteristics**:
- Two data paths: the Gemini intake (first run) and a manual edit surface (later).
- The CRUD surface re-implements identity resolution and confidence flagging.

**Advantages**:
- Onboarding code is untouched; the new surface can be tailored to editing.
- Explicit manual control over individual positions.

**Disadvantages**:
- A second, parallel write path to maintain that will diverge from the intake.
- The intake already does ISIN/symbol resolution and confidence flagging that manual
  CRUD would have to duplicate or skip — duplication or inconsistency either way.
- More UI and more server surface for strictly less reuse than one merging intake.

**Risk Assessment**:
- **Technical Risk**: Medium. Two write paths into the same durable book.
- **Schedule Risk**: Medium. Builds and maintains a second surface.
- **Ecosystem Risk**: Medium. Divergence between onboarding and editing semantics over
  time is a maintenance and correctness hazard.

## Decision

Adopt **Option 1**: the holdings intake is **always-available** and confirming it
**merges proposed holdings into the existing book on canonical identity, with
per-instrument conflicts resolved by the user**, while the server persists and
re-validates the complete book.

The implementation will use:
- **A single always-available intake screen** entered from both the empty-state "feed
  the terminal" button and a dashboard-header "+ add" affordance; `app.ts` routing no
  longer gates the intake on an empty book. Onboarding is the empty-book special case,
  never framed as a separate "add later" mode.
- **`mergeInventory` in `apps/web/src/inventory.ts`** — a pure function
  `(existing, additions, resolve) → mergedBook` matching on ISIN-else-symbol (ADR-0007),
  appending new instruments and routing collisions through the per-key resolver.
- **A per-conflict segmented choice on the confirm screen** ("replace" vs "+add") that
  drives the resolver; the screen assembles the complete intended book.
- **`confirmInventory`** unchanged in mechanism: it receives the already-merged
  complete book, validates every position, and `.set`s it under the verified `uid`
  (ADR-0004, ADR-0008).

## Consequences

### Positive

1. **The book is a living document**: positions can be added and extended at any time;
   the terminal reflects an evolving portfolio rather than a write-once snapshot.
2. **One intake path for every case**: first-run and every later addition share the
   same screen, identity resolution, and confidence flagging — no parallel surface.
3. **User-controlled resolution**: collisions are decided per instrument by the human
   ("user disposes," §3); no merge policy is hidden in the server.
4. **Server remains the validating authority**: the privileged write path still
   re-validates the complete book and the `.set` contract is unchanged (ADR-0008).
5. **Pure, tested merge**: `mergeInventory` is side-effect-free and unit-tested, with
   no change to the book schema.

### Negative

1. **More confirm-screen state**: the screen now carries a resolution choice per
   conflicting row, increasing its UI complexity.
2. **Merge runs client-side**: the server validates but does not itself merge, so the
   merge rule lives in client code rather than next to the persistence step.
3. **"replace" discards prior data silently**: choosing replace drops the prior
   position, including any cost basis it carried — flagged as a follow-up below.

### Neutral

1. **Last-write-wins across devices**: concurrent confirms from two devices overwrite
   each other at book granularity; multi-device concurrency control is out of scope
   here and noted as future work.
2. **No book schema change**: the durable inventory shape (ADR-0004) is untouched; only
   the path that produces it changes.

## Decision Outcome

The decision makes the intake serve the whole portfolio lifecycle while honouring
cancri's invariants: the book becomes a living document (product premise), collisions
are resolved by the user per instrument ("machine proposes, user disposes," §B/§3),
and the server stays the re-validating authority on the privileged write path
(ADR-0004, ADR-0008) by persisting a complete, already-merged book through the
unchanged `.set` mechanism. Matching reuses the ADR-0007 canonical key, and the merge
itself is a pure, unit-tested function with no book schema change.

Mitigations:
- **"replace" discards cost basis**: tracked as a follow-up to preserve or explicitly
  confirm loss of a prior position's cost basis when the user picks replace.
- **Client-side merge vs server validation**: keep `mergeInventory` pure and
  unit-tested, and rely on `confirmInventory` to re-validate every position so a
  malformed merged book is rejected regardless of how the client computed it.
- **Multi-device last-write-wins**: documented as out of scope; revisit with
  optimistic concurrency on the book document if multi-device editing becomes a need.
- **No silent degrade on normalisation**: the sibling implementation removes the
  silent degrade-to-offline-parser fallback so that degraded normalisation surfaces as
  a clarify/error state, never a silent bad write — honouring ADR-0008's existing
  mitigation on the privileged write path.

## Related Decisions

- [ADR-0004: Datastore Split](0004-datastore-split-firestore-book-rtdb-wire.md) - defines the durable
  per-user Firestore book; this ADR defines how that book is **extended** over time
  rather than overwritten.
- [ADR-0007: ISIN Canonical Identity](0007-isin-resolution-llm-proposes-resolver-disposes.md) - the
  ISIN-else-symbol canonical key is the match key the merge uses to detect conflicts.
- [ADR-0008: Gemini Callable / Confirm Write Path](0008-gemini-vertex-iam-callable.md) - `confirmInventory`
  now persists a **merged** book; the sibling implementation also drops the silent
  degrade-to-offline-parser fallback to comply with ADR-0008's mitigation that
  degraded normalisation must surface as clarify/error, never a silent bad write.

## Links

- `design/IMPLEMENTATION_BRIEF.md` §B Portfolio onboarding pipeline (propose/approve)
  and §3 Governance & security ("the machine proposes, the user disposes").

## More Information

- **Date:** 2026-06-27
- **Source:** cancri implementation brief (§B, §3) and the intake/merge implementation
  reworking one-shot onboarding into an always-available, merging intake.
- **Related ADRs:** ADR-0004, ADR-0007, ADR-0008.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | apps/web/src/inventory.ts (mergeInventory); apps/web/src/screens/confirm.ts (conflict UI); apps/web/src/screens/onboard.ts, apps/web/src/screens/dashboard.ts (always-available intake); apps/web/src/app.ts (confirmAndGoLive takes the merged book) | - | pending |

**Summary:** ADR created, awaiting implementation.

**Action Required:** Implement decision and audit.
</content>
</invoke>
