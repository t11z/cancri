---
title: "Self-Heal App-Authored PR Gated by Offline Replay"
description: "The capture Job proposes protocol fixes as a GitHub App PR gated by an offline deterministic frame-to-price replay in CI, with a human merge."
type: adr
category: testing
tags: [self-heal, deterministic-replay, governance]
status: accepted
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [github-app, github-actions, playwright, cloud-run-jobs, typescript]
---

# ADR-0010: Self-Heal App-Authored PR Gated by Offline Replay

## Status

Accepted

## Context

### Background and Problem Statement

cancri's primary price source is L&S via the public ls-tc.de push, which rides an
undocumented "Lightstreamer 6" protocol with no API contract (Appendix A). The brief
(section D) requires the system to *detect* when that protocol changes and to *propose*
a fix — handshake parameters, frame byte offsets / line ending, or ISIN→internal-id
remapping — without a human babysitting the source. ADR-0009 already quarantined that
break surface into a versioned, data-driven `ls-protocol` module so a fix is a small,
reviewable change. This ADR decides *how a candidate fix is produced, verified, and
landed*.

The hard part is verification. A parser fix cannot be trusted because it "looks right"
or because it merely produces *a* number. The brief gives the only sound oracle: a real
browser drives the live page during trading hours, records the raw protocol frames, and
*simultaneously scrapes the price rendered on the page*. That pair — raw frame plus the
price the source itself displayed at that instant — is ground truth from the same source,
same moment, no delay. A parser is correct *iff* it reproduces those rendered prices from
those recorded frames, offline and deterministically. That makes verification a pure
replay regression over real fixtures, not a live-network test.

Two governance invariants from the brief (sections 3 and D) bound the design. First,
**propose/approve, no auto-merge**: the agent proposes a pull request, a human disposes —
exactly mirroring the inventory confirm screen on the data side. Second, **the fixture
corpus is the audit trail**: every landed fix snapshots its working frames plus expected
prices append-only, serving simultaneously as protocol-documentation-by-example and as the
regression base for the next break.

This decision is **hard to reverse**. The capture-and-diff loop, the GitHub App identity,
the CI replay gate, the path-allowlist, and the append-only in-repo corpus together form
the project's trust boundary for autonomous code change. The corpus accretes real recorded
frames over the project's life; moving it, or changing what authors a self-heal PR, breaks
the regression history, the diffability of the protocol-by-example, and the security
review that fires on App-authored PRs. Once self-heal PRs have been merging through this
pipeline, the pipeline *is* the protocol's institutional memory.

### Current Limitations

1. There is no decided mechanism that turns a captured frame/price pair into a landed,
   reviewed code change — only ADR-0009's claim that the surface is bounded and replayable.
2. Without a deterministic offline oracle, any proposed fix would have to be validated
   against a live, drifting, trading-hours-only source — non-reproducible and unciteable
   in review.
3. Without an authorship and path policy, an automated PR could touch arbitrary code, and
   nothing would enforce the brief's no-auto-merge invariant at the platform level.
4. Yahoo is the runtime sanity oracle and degradation fallback (Appendix B, ADR-0003); it
   is delayed (~15 min for German venues) and is therefore unfit to *verify* a cent-accurate
   L&S parser, yet it is the obvious wrong temptation.

## Decision Drivers

### Primary Decision Drivers

1. **Ground truth is the frame/price pair, not a live comparison**: the browser captures
   the raw frame and the simultaneously-rendered price from the same source at the same
   moment; correctness is *reproduction of those prices offline*, so the verifier must be a
   deterministic replay over recorded fixtures.
2. **Propose/approve, never auto-merge (brief §3, §D)**: the self-heal path must structurally
   prevent silent adoption — a human merges. This is a governance invariant, not a
   preference, and must be enforced by the platform (branch protection), not by convention.
3. **Bounded break surface (ADR-0009, Appendix A)**: a fix may only touch the `ls-protocol`
   modules and the fixture corpus; a CI path-allowlist must reject any PR that reaches
   outside that surface, keeping the autonomous-change blast radius minimal.
4. **Same code in Job and CI**: the replay engine (`selfheal-core`) must be pure — no
   Playwright, no network — so the *identical* frame-to-price replay runs both inside the
   capture Job (to form the candidate) and inside CI (as the merge gate). Divergence
   between "what the Job proved" and "what CI checks" would void the guarantee.

### Secondary Decision Drivers

1. **Trigger the existing review/triage workflows**: a GitHub App identity (not the default
   `GITHUB_TOKEN`) is required so that the PR fires downstream CI and the security-review /
   triage automations; `GITHUB_TOKEN`-authored events deliberately do not cascade.
2. **Audit-by-example (brief §3)**: the append-only in-repo corpus doubles as the protocol
   documentation and the regression base, so it must live in the repo where it is diffable,
   reviewable, and versioned with the parser it validates.
3. **Firebase-only, server-side, read-only platform**: capture is a heavyweight,
   trading-hours-only, browser-driven operation that cannot live in a request-scoped
   Function (no long-lived sockets/browsers — ADR-0002) and must not touch the read-only
   runtime; it belongs in an on-demand Cloud Run Job (ADR-0003), isolated from the
   always-on feed-engine.
4. **Heavy capture fires rarely**: capture-and-diff runs only after several consecutive
   probe failures, so the expensive browser path stays cheap in aggregate and the cheap
   in-process liveness/sanity probe carries the routine load.

## Considered Options

### Option 1: Cloud Run Job → App PR + `selfheal-core` Deterministic Replay in CI + Path-Allowlist + Branch Protection

**Description**: After sustained probe failure, an on-demand Cloud Run Job drives a real
browser against the live L&S page, records raw frames paired with the simultaneously
rendered prices, and runs the pure `selfheal-core` replay to synthesise a candidate
`ls-protocol` change plus an append-only fixture entry. Authenticated as a GitHub App, the
Job opens a pull request touching *only* the `ls-protocol` modules and the in-repo fixture
corpus. CI re-runs the same `selfheal-core` replay as a required check, enforces a
path-allowlist, and branch protection forbids auto-merge — a human merges.

**Technical Characteristics**:
- Capture-and-diff runs as a Cloud Run Job (ADR-0003), separate from the always-on
  feed-engine; Playwright lives only here.
- `selfheal-core` is a pure TS package: `(frames, expectedPrices) → pass/fail + decoded
  prices`, no Playwright and no network, imported by both the Job and CI.
- PR authored by a GitHub App installation token, so the PR/`push` events cascade to the
  existing security-review and triage workflows.
- CI required checks: (a) `selfheal-core` replay green over the *entire* corpus including
  the new fixtures; (b) a path-allowlist job that fails if any changed file is outside
  `ls-protocol/**` or the corpus.
- Branch protection: required reviews + required checks, no auto-merge, no force-push to the
  corpus history.
- Fixtures are append-only in-repo, doubling as protocol-by-example and regression base.

**Advantages**:
- Verifier and proposer run identical code, so a CI-green PR is provably the same artefact
  the Job validated.
- The no-auto-merge invariant is enforced by the platform (branch protection), not by
  hoping the bot behaves.
- App authorship lights up the existing security-review/triage pipeline automatically.
- The path-allowlist mechanises ADR-0009's bounded surface; an over-reaching fix cannot pass.
- The corpus is diffable, reviewable, and versioned alongside the parser it proves.

**Disadvantages**:
- More moving parts to stand up: a Cloud Run Job, a GitHub App install, two CI gates,
  branch-protection config.
- The corpus grows monotonically in the repo, adding weight over time.
- Requires maintaining the App's least-privilege permissions and key rotation.

**Risk Assessment**:
- **Technical Risk**: Medium. The pure-replay/Job split is clean, but the live capture is
  inherently flaky (trading-hours-only, real browser) and must degrade gracefully when it
  cannot capture.
- **Schedule Risk**: Medium. Several discrete pieces (Job, App, CI gates) must all land
  before the loop is trustworthy.
- **Ecosystem Risk**: Low. GitHub Apps, branch protection, Actions, and Cloud Run Jobs are
  all first-class, stable primitives.

### Option 2: Auto-Merge a Passing Candidate

**Description**: When the `selfheal-core` replay passes in CI, the bot merges its own PR
automatically — full closed-loop self-healing with no human in the path.

**Technical Characteristics**:
- Same capture/replay machinery, but with `gh pr merge --auto` (or equivalent) wired to a
  green check.
- No required human review; the deterministic gate is treated as sufficient.

**Advantages**:
- Fastest possible recovery from a protocol break — zero human latency.
- Operationally simplest steady state once trusted.

**Disadvantages**:
- Directly violates the brief's propose/approve invariant (§3, §D): "the agent proposes a
  PR, a human merges. No auto-merge."
- A passing replay proves the parser reproduces *recorded* prices, not that the capture
  itself was honest (e.g. a spoofed or stale page) — a human is the check on the oracle.
- Concentrates full write authority over the protocol module in an autonomous agent.

**Risk Assessment**:
- **Technical Risk**: High. A poisoned or mis-scraped capture would auto-land with no human
  circuit-breaker.
- **Schedule Risk**: Low. Marginally less to build than Option 1.
- **Ecosystem Risk**: Low. Auto-merge is a supported GitHub feature.

**Disqualifying Factor**: Violates the mandatory propose/approve, no-auto-merge governance
invariant of the brief.

### Option 3: Verify Fixes Against Yahoo

**Description**: Instead of an offline replay over recorded frames, validate a candidate
parser by comparing its decoded L&S prices against live Yahoo quotes within a tolerance.

**Technical Characteristics**:
- Reuses the runtime sanity-oracle comparison (ADR-0003) as the merge gate.
- No fixture corpus needed for verification; gate is a live cross-source check.

**Advantages**:
- No corpus to maintain; conceptually reuses an existing comparison.
- Always available whenever both feeds are up.

**Disadvantages**:
- Yahoo is *delayed* (~15 min, German venues — Appendix B) and is the runtime oracle and
  fallback, never the fix verifier; the brief explicitly states "Yahoo does not verify the
  fix."
- Non-deterministic and non-reproducible: a review cannot re-run the same check on the same
  inputs, and it only works during trading hours with both feeds live.
- Tolerance-based comparison cannot prove *cent-accurate* frame decoding, which is the whole
  point of the L&S tap.

**Risk Assessment**:
- **Technical Risk**: High. A delayed, drifting reference cannot certify a cent-accurate
  parser; false passes and false fails both likely.
- **Schedule Risk**: Low. Little new code.
- **Ecosystem Risk**: Medium. Couples the merge gate to Yahoo's availability and protobuf
  stability.

**Disqualifying Factor**: Conflicts the verifier with the runtime oracle; the brief forbids
Yahoo as fix verifier.

### Option 4: Fixtures in GCS Only

**Description**: Keep the captured frame/price fixtures in a Cloud Storage bucket rather than
in the repo; CI pulls them at gate time and the PR carries only the code change.

**Technical Characteristics**:
- Job writes fixtures to GCS; CI fetches them to run `selfheal-core`.
- PR diff contains code only; evidence lives out-of-band.

**Advantages**:
- Keeps the repo small; large frame blobs never bloat git history.
- Centralised object lifecycle management for the captures.

**Disadvantages**:
- Loses the in-repo, diffable protocol-doc-by-example the brief calls the audit trail (§3).
- The regression base is no longer versioned atomically with the parser it validates —
  fixtures and code can drift, and a reviewer cannot see the evidence in the PR.
- Adds a GCS auth/availability dependency to the CI gate and weakens append-only guarantees.

**Risk Assessment**:
- **Technical Risk**: Medium. Decoupling evidence from code invites fixture/parser drift.
- **Schedule Risk**: Low. Comparable build effort to Option 1.
- **Ecosystem Risk**: Medium. CI now depends on GCS reachability and credentials at gate time.

**Disqualifying Factor**: Breaks the in-repo audit-by-example and the atomically-versioned
regression base required by the brief.

### Option 5: `GITHUB_TOKEN`-Authored PR

**Description**: Open the self-heal PR using the default Actions/`GITHUB_TOKEN` identity
rather than a dedicated GitHub App installation.

**Technical Characteristics**:
- Same capture/replay/allowlist, but the PR is authored by the built-in token.

**Advantages**:
- No GitHub App to register, install, or key-manage.
- Simplest authentication path.

**Disadvantages**:
- Events created by `GITHUB_TOKEN` deliberately do **not** trigger further workflow runs, so
  the security-review and triage automations would not fire on the self-heal PR.
- The very governance/review layer this decision depends on would be silently skipped.

**Risk Assessment**:
- **Technical Risk**: Medium. Silent loss of downstream review is a subtle, dangerous failure
  mode.
- **Schedule Risk**: Low. Least to build.
- **Ecosystem Risk**: Low. Standard GitHub behaviour — but that behaviour is precisely the
  problem.

**Disqualifying Factor**: `GITHUB_TOKEN`-authored PRs do not cascade to downstream CI, so the
required review workflows never run.

## Decision

Adopt **Option 1**. cancri's self-heal loop is: the in-process probe on the feed-engine plus
a Cloud Scheduler `/healthz` watchdog (ADR-0004 self-heal facet) detects a sustained L&S
break; after several consecutive failures an on-demand **Cloud Run Job** (ADR-0003) drives a
real browser against the live ls-tc.de page, records raw frames paired with the
simultaneously-rendered prices, and runs the pure **`selfheal-core`** replay to synthesise a
candidate change to the **`ls-protocol`** module (ADR-0009) and an append-only fixture entry.
Authenticated as a **GitHub App**, the Job opens a pull request whose diff is limited to
`ls-protocol/**` and the in-repo fixture corpus. The required merge gate is the **same
`selfheal-core` frame-to-price replay run in CI** over the whole corpus, plus a
**path-allowlist** check; **branch protection** forbids auto-merge and a **human merges**.

The implementation will use:
- **Cloud Run Job (on-demand)** for browser-driven capture-and-diff, isolated from the
  always-on feed-engine and from the read-only request path.
- **`selfheal-core` (pure TS package)** for the deterministic frame-to-price replay, imported
  unchanged by both the Job and CI so the proposer and the verifier are byte-identical logic.
- **`ls-protocol` (ADR-0009)** as the sole code surface a self-heal PR may modify.
- **An append-only in-repo fixture corpus** as both protocol-documentation-by-example and the
  regression base.
- **A GitHub App installation token** for PR authorship, so downstream security-review/triage
  workflows cascade.
- **CI required checks**: `selfheal-core` replay green over the full corpus + a path-allowlist
  gate, with **branch protection** enforcing required review and no auto-merge.

## Consequences

### Positive

1. **Provable verification**: a CI-green self-heal PR is, by construction, the exact artefact
   the Job validated, because both run the same pure replay over the same recorded frames.
2. **Governance enforced by the platform**: branch protection makes no-auto-merge a structural
   guarantee, not a convention, satisfying the brief's propose/approve invariant.
3. **Mechanised blast-radius limit**: the path-allowlist turns ADR-0009's bounded break surface
   into an enforced CI gate; an over-reaching fix cannot merge.
4. **Audit-by-example for free**: the append-only in-repo corpus is simultaneously the audit
   trail, the living protocol documentation, and the regression base for future breaks.
5. **Existing review pipeline reused**: App authorship lights up the security-review and triage
   automations on every self-heal PR with no extra wiring.

### Negative

1. **Operational surface area**: a Cloud Run Job, a GitHub App, two CI gates, and
   branch-protection config must all be stood up and kept healthy — more to build and own than
   any single-piece alternative.
2. **Human latency in recovery**: because a human must merge, the protocol fix does not land the
   instant CI is green; until merge, the system runs on the delayed Yahoo fallback. The
   degradation path (ADR-0003) is what makes this acceptable, but recovery is not instantaneous.
3. **Monotonic corpus growth**: the in-repo fixture corpus only ever grows, gradually adding
   repo weight and lengthening the full-corpus replay over the project's life.
4. **Capture flakiness**: live browser capture is trading-hours-only and inherently brittle; a
   break outside trading hours, or a failed capture, yields no candidate PR and the system waits
   on the fallback.
5. **Hard to reverse**: the corpus, the App identity, and the gate pipeline become the protocol's
   institutional memory; changing where fixtures live or who authors PRs later forfeits regression
   history, diffability, and the cascading review.

### Neutral

1. **Capture confined to a Job**: heavyweight browser work is isolated from the always-on
   feed-engine and the request-scoped Functions, consistent with the runtime-class split
   (ADR-0002, ADR-0003).
2. **Self-heal touches only `ls-protocol`**: all other modules are out of bounds for the loop by
   policy, concentrating both the risk and the maintenance in one quarantined place.
3. **Yahoo's role is fixed**: it remains the runtime oracle and degradation fallback and is never
   promoted to fix verifier.

## Decision Outcome

The objectives are met: verification is a deterministic offline replay of the browser's own
ground-truth frame/price pairs (driver 1); propose/approve is enforced by branch protection with
a human merge (driver 2); the bounded surface is enforced by a CI path-allowlist over the
`ls-protocol` module (driver 3); and the Job and CI share the pure `selfheal-core` so proposer
and verifier are identical (driver 4). App authorship cascades into the existing review/triage
workflows, and the append-only in-repo corpus serves as audit-by-example and regression base.

Mitigations:
- **Operational surface (Negative 1)**: stand the pieces up incrementally behind the existing
  probe; the loop degrades safely to "no PR" until each piece is in place, so partial setup is
  never unsafe.
- **Human-merge latency (Negative 2)**: the automatic degradation to Yahoo with a visible
  `freshness: delayed` marker (ADR-0003) keeps the dashboard live, not dark, during the
  propose→review→merge window.
- **Corpus growth (Negative 3)**: fixtures are minimal frame/price slices, not full captures, and
  the replay is parallelisable in CI; revisit corpus sharding only if gate time becomes material.
- **Capture flakiness (Negative 4)**: the heavy capture fires only after repeated probe failures
  and retries within trading hours; a failed capture simply leaves the system on the fallback,
  which is a safe state, not an outage.
- **Hard to reverse (Negative 5)**: the boundaries (corpus location, App identity, allowlist
  paths) are pinned here and in ADR-0009 precisely so they are not casually changed.

## Related Decisions

- [ADR-0002: Runtime Classes Topology](0002-three-runtime-classes-execution-model.md) - Functions cannot hold
  browsers or sockets; capture-and-diff therefore lives in a Cloud Run Job, not a Function.
- [ADR-0003: Feed-Engine and Capture Job](0003-feed-engine-single-process-singleton.md) - Defines the
  on-demand Cloud Run Job that runs the browser capture and Yahoo's role as runtime
  oracle/fallback that this ADR forbids as the fix verifier.
- [ADR-0004: Two-Store Datastore Split](0004-datastore-split-firestore-book-rtdb-wire.md) - The probe/`/healthz`
  watchdog and feed-status that trigger the heavy capture path.
- [ADR-0006: Tick Data Contract](0006-tick-schema-and-source-adapter-contract.md) - The normalised tick the parser
  must reproduce; `selfheal-core` decodes frames into this shape.
- [ADR-0007: ISIN Canonical Identity](0007-isin-resolution-llm-proposes-resolver-disposes.md) - The id-remapping facet of
  the break surface is keyed on ISIN.
- [ADR-0009: L&S Protocol Quarantine Module](0009-ls-protocol-break-surface-isolation.md) - Defines the
  versioned, data-driven `ls-protocol` module that is the only code a self-heal PR may touch.

## Links

- [cancri Implementation Brief](../../design/IMPLEMENTATION_BRIEF.md) - Section D (self-healing
  maintenance) and Section 3 (governance: propose/approve, no auto-merge, audit-by-corpus).
- [Implementation Brief, Appendix A](../../design/IMPLEMENTATION_BRIEF.md) - L&S break surface:
  handshake params, frame byte offsets / line ending, ISIN→internal-id remapping.
- [Implementation Brief, Appendix B](../../design/IMPLEMENTATION_BRIEF.md) - Yahoo facts: delayed
  German venues, why it is the runtime oracle/fallback and not the fix verifier.

## More Information

- **Date:** 2026-06-27
- **Source:** cancri Implementation Brief §D, §3, Appendix A, Appendix B; decomposition pass
  cross-cutting decision 4.
- **Related ADRs:** 0002, 0003, 0004, 0006, 0007, 0009.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created, awaiting implementation.

**Action Required:** Implement decision and audit.
