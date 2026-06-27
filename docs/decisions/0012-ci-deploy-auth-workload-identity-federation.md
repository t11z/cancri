---
title: "CI Deploy Auth via Workload Identity Federation"
description: "GitHub Actions deploys authenticate to GCP/Firebase via WIF + a dedicated deployer service account; no long-lived keys, no FIREBASE_TOKEN."
type: adr
category: security
tags: [ci-cd, workload-identity-federation, firebase-deploy, cloud-run, iam]
status: proposed
created: 2026-06-27
updated: 2026-06-27
author: "Architecture (Claude Code)"
project: cancri
technologies: [github-actions, google-github-actions-auth, firebase-tools, gcloud, cloud-run]
---

# ADR-0012: CI Deploy Auth via Workload Identity Federation

## Status

Proposed

## Context

### Background and Problem Statement

cancri deploys several surfaces from GitHub Actions (ADR-0002): Firebase Hosting, Cloud
Functions (2nd gen), Firestore + RTDB security rules, the always-on Cloud Run `feed-engine`
service, and the self-heal Cloud Run Job. All of these must be deployed by CI without a
human running `firebase login`, and — per the repo's security posture — **without a
long-lived service-account JSON key stored as a secret**. We must pick how CI authenticates
to GCP/Firebase, and pin it now because it shapes the IAM topology (a deployer principal,
its roles, and a federation trust) that every later deploy step is built against — costly to
re-cut once Functions/Run/rules deploys all assume it.

Two forces make this non-trivial in mid-2026: (1) firebase-tools has **deprecated the legacy
`firebase login:ci` / `FIREBASE_TOKEN` flow** and now authenticates via Application Default
Credentials (ADC); (2) the architect has previously hit real failures combining Workload
Identity Federation (WIF) with recent firebase-tools — chiefly the v15 ADC-resolution timeout
that surfaces as the misleading `Failed to authenticate, have you run firebase login?`
(firebase-tools issue #10726). The decision must be future-proof under "always use the latest
tools" while avoiding that pain.

### Current Limitations

1. No deploy pipeline exists yet; the bootstrap CI is a stack-agnostic skeleton.
2. `firebase login:ci` tokens are end-of-life and emit a removal warning, so a token-based
   pipeline would be built on a deprecated foundation.
3. Long-lived JSON keys are discouraged (and often org-policy-blocked), and contradict the
   project's "no stored credentials" stance.

## Decision Drivers

### Primary Decision Drivers

1. **No long-lived credentials.** Keyless, short-lived federated credentials over a stored
   JSON key or token.
2. **Future-proof under latest tools.** Survive firebase-tools major bumps; the legacy token
   path is already deprecated.
3. **One trust covers all surfaces.** The same auth must serve `firebase` (Hosting/Functions/
   rules) and `gcloud` (Cloud Run service + Job).
4. **Avoid the known firebase-tools v15 ADC pitfall** (#10726) by design, not luck.

### Secondary Decision Drivers

1. **Least privilege.** A dedicated deployer principal, runtime SAs kept separate, repo-pinned
   federation.
2. **Auditability / blast-radius.** Federation scoped to this repo; no key to leak or rotate.

## Considered Options

### Option 1: WIF + ADC, firebase for Firebase surfaces, gcloud for Cloud Run

**Description**: `google-github-actions/auth` mints short-lived credentials via WIF and
impersonates a dedicated deployer service account, writing an ADC credentials file. Firebase
Hosting/Functions/rules deploy with `firebase-tools` (ADC, explicit `GOOGLE_APPLICATION_CREDENTIALS`,
always `--project`); the Cloud Run service and Job deploy with `gcloud`, which reads the same
ADC natively.

**Technical Characteristics**:
- No stored secret: GitHub OIDC token → WIF → SA impersonation → ADC file.
- Tooling split: `firebase deploy --only hosting,functions,firestore:rules,database`; `gcloud run deploy` / `gcloud run jobs deploy`.
- Deployer SA `actAs` the separate runtime SAs; quota project + `serviceusage.serviceUsageConsumer` set.

**Advantages**:
- Keyless and short-lived; nothing to rotate or leak.
- Google's sanctioned direction for both `gcloud` and `firebase-tools`.
- Routing Cloud Run through `gcloud` sidesteps the firebase-tools #10726 ADC-timeout entirely.
- One federation trust serves every surface.

**Disadvantages**:
- More upfront setup (WIF pool/provider, deployer SA, role grants, `actAs`).
- The firebase-tools step can still hit the #10726 timeout on the Firebase surfaces; needs the mitigations below.

**Risk Assessment**:
- **Technical Risk**: Medium. The #10726 timeout is real but bounded and mitigated (pin firebase-tools, explicit ADC, retry, documented break-glass).
- **Schedule Risk**: Low. One-time IAM setup; well-documented action.
- **Ecosystem Risk**: Low. WIF + `google-github-actions/auth` is the durable, recommended path.

### Option 2: Service-account JSON key as a GitHub secret

**Description**: Create a deployer SA, download its JSON key, store it as a secret, and point
ADC at it.

**Technical Characteristics**: A static key file materialised in CI.

**Advantages**:
- Simplest to wire; works today and is the most reliable #10726 fallback.

**Disadvantages**:
- A long-lived credential to leak/rotate; contradicts the project's no-stored-keys stance.
- Increasingly blocked by org policy (key creation disabled).

**Risk Assessment**:
- **Technical Risk**: Low (it works), but **Security Risk High** — a leakable standing key.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Medium. Actively discouraged direction.

### Option 3: Legacy `firebase login:ci` / `FIREBASE_TOKEN`

**Description**: A long-lived refresh token in a secret, consumed via `--token`.

**Advantages**:
- Historically simple; still functions in firebase-tools v15.

**Disadvantages**:
- **Deprecated** with a removal warning; building new pipelines on it is a dead end.
- Token-only; does not authenticate `gcloud` for Cloud Run.

**Risk Assessment**:
- **Technical Risk**: Medium (works now, removal looming).
- **Schedule Risk**: High — guaranteed future rework when removed.
- **Ecosystem Risk**: High — end-of-life.

### Option 4: FirebaseExtended/action-hosting-deploy or Firebase App Hosting

**Description**: Use the Hosting-only deploy action, or adopt Firebase App Hosting (the newer
full-stack product) with its GitHub-connection auto-rollouts.

**Advantages**:
- action-hosting-deploy is turnkey for Hosting; App Hosting offers managed rollouts.

**Disadvantages**:
- action-hosting-deploy is Hosting-only (no Functions/Cloud Run/Jobs) and historically wants a
  SA JSON — a second auth path for one surface.
- App Hosting is a different product (framework/SSR on Cloud Run), not a drop-in for our
  static SPA + separate Functions + own Cloud Run service/Job; adopting it is a re-architecture.

**Risk Assessment**:
- **Technical Risk**: Medium (partial coverage / re-architecture).
- **Schedule Risk**: High (App Hosting) — large scope change.
- **Ecosystem Risk**: Low for the products themselves, but a poor fit for this stack now.

## Decision

Adopt **Option 1**. CI authenticates via **Workload Identity Federation** using
`google-github-actions/auth` to impersonate a **dedicated deployer service account**, with no
stored key and no `FIREBASE_TOKEN`.

The implementation will use:
- **A WIF pool/provider** with an attribute-condition pinning `assertion.repository == 't11z/cancri'`, and the deployer SA granted `roles/iam.workloadIdentityUser` for that repo's `principalSet`.
- **A dedicated deployer SA** (e.g. `cancri-deployer@…`), separate from the runtime SAs of the feed-engine/Functions/Job, with `roles/iam.serviceAccountUser` to `actAs` them.
- **`firebase-tools` (version-pinned)** for Hosting + Functions(2nd gen) + Firestore/RTDB rules, invoked with an explicit `GOOGLE_APPLICATION_CREDENTIALS` (the auth action's `credentials_file_path`), always `--project`, and a quota project (`roles/serviceusage.serviceUsageConsumer` + `GOOGLE_CLOUD_QUOTA_PROJECT`).
- **`gcloud run deploy` / `gcloud run jobs deploy`** for the Cloud Run service and Job, reading the same ADC — deliberately keeping the long-running container deploys off the firebase-tools auth path (avoids #10726).
- **Job permissions** `id-token: write` + `contents: read`; the auth action with `create_credentials_file: true` and `export_environment_variables: true`.
- **`FIREBASE_TOKEN`** documented as break-glass only, never the primary path.

## Consequences

### Positive

1. No long-lived credential exists to leak or rotate; CI uses short-lived federated tokens.
2. One federation trust authenticates both `firebase` and `gcloud`, covering every surface.
3. The Cloud Run deploys avoid the firebase-tools ADC-timeout class of failure by using `gcloud`.
4. Least-privilege, repo-scoped trust with separated deployer and runtime identities.

### Negative

1. More moving parts than a key file: a WIF pool/provider, a deployer SA, role grants, and `actAs` bindings to get right before the first green deploy.
2. The firebase-tools surfaces can still hit the #10726 timeout; requires pinning, explicit ADC, and a retry/break-glass plan.
3. A daily/monthly drift risk: "always latest firebase-tools" can reintroduce auth regressions, so the version is pinned and bumped deliberately.

### Neutral

1. The deployer's role set is explicit and reviewable (Hosting/rules/Functions/Run admin + `serviceUsageConsumer` + `serviceAccountUser`), rather than a single broad `firebase.admin`.
2. This GCP/Firebase deploy auth is orthogonal to the repo's Claude/Anthropic OAuth-only rule (that governs Claude tooling tokens, not GCP deploys); no conflict.

## Decision Outcome

The objectives — keyless, future-proof, single-trust, pitfall-avoiding — are met: WIF removes
stored credentials, the `gcloud`/`firebase` split routes each surface through the auth path
that works for it, and the known firebase-tools v15 timeout is contained rather than wished
away.

Mitigations:
- For #10726: pin firebase-tools, set `GOOGLE_APPLICATION_CREDENTIALS` on the firebase step, retry once, and keep a documented `FIREBASE_TOKEN` break-glass; deploy Cloud Run via `gcloud`.
- For setup complexity: codify the pool/provider/SA/roles as a one-time documented step (and later as IaC), with the repo-pinned attribute-condition.
- For "latest tools" drift: bump firebase-tools as a reviewed change, not implicitly.

## Related Decisions

- [ADR-0002: Three Runtime Classes](0002-three-runtime-classes-execution-model.md) - defines the surfaces (Functions, Cloud Run service, Cloud Run Job) this pipeline deploys.
- [ADR-0010: Self-Heal Governance](0010-self-heal-governance-pr-deterministic-gate.md) - the self-heal Job is one of the Cloud Run deploy targets; its PR flow uses the GitHub App, a separate identity from this deployer SA.
- [ADR-0008: Gemini via Vertex IAM](0008-gemini-vertex-iam-callable.md) - same keyless, IAM-over-secrets philosophy applied to runtime LLM calls.

## Links

- firebase-tools #10726 — firebase deploy ADC/WIF v15 timeout (the architect's pitfall): https://github.com/firebase/firebase-tools/issues/10726
- google-github-actions/auth — WIF, `create_credentials_file`, `GOOGLE_APPLICATION_CREDENTIALS`: https://github.com/google-github-actions/auth
- WIF with deployment pipelines (principalSet, workloadIdentityUser): https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
- firebase-tools `--token` deprecation guidance: https://github.com/firebase/firebase-tools/discussions/6283

## More Information

- **Date:** 2026-06-27
- **Source:** Deploy-auth research pass (mid-2026); the architect's prior WIF + firebase-tools experience.
- **Related ADRs:** 0002, 0008, 0010.

## Audit

### 2026-06-27

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
|---------|-------|-------|------------|
| Awaiting implementation | - | - | pending |

**Summary:** ADR created, awaiting implementation (deploy.yml + WIF/IAM setup land in the deploy/CI-hardening phase).

**Action Required:** Implement decision and audit.
