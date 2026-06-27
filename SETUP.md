# Setup

One-time setup so the Claude workflows can run. All Claude authentication uses
`CLAUDE_CODE_OAUTH_TOKEN` — never `ANTHROPIC_API_KEY`.

## Secrets to create

| Secret | Used by | How to get it |
|--------|---------|---------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | security-review, issue-triage | `claude setup-token` (locally, Pro/Max account) |
| `APP_ID` | issue-triage | GitHub App → App ID |
| `APP_PRIVATE_KEY` | issue-triage | GitHub App → generated private key (.pem contents) |

## 1. Claude OAuth token

```bash
claude setup-token
```

Copy the token (`sk-ant-oat...`) and store it as the repo secret `CLAUDE_CODE_OAUTH_TOKEN`:

```bash
gh secret set CLAUDE_CODE_OAUTH_TOKEN
```

These tokens are CI-capable but finite. If a workflow fails with an auth error,
regenerate and update the secret.

## 2. GitHub App (for the triage bot)

The triage bot acts as a GitHub App so it has a real identity and so the PRs it
opens can trigger your other workflows (the default `GITHUB_TOKEN` cannot do that).

Run the helper, which walks you through it and pre-fills the required permissions:

```bash
./scripts/bootstrap-github-app.sh
```

Or do it manually:

1. Create a GitHub App (Settings → Developer settings → GitHub Apps → New).
   Repository permissions: **Issues: Read & write**, **Pull requests: Read & write**,
   **Contents: Read & write**. Subscribe to events: Issues, Issue comment, Pull request.
2. Generate a private key (.pem) and note the App ID.
3. Install the App on this repository.
4. Store the secrets:
   ```bash
   gh secret set APP_ID
   gh secret set APP_PRIVATE_KEY < path/to/private-key.pem
   ```

## 3. Repository hardening

- Settings → Actions → "Require approval for all external contributors" (the
  security-review workflow only runs on same-repo PRs, but keep this on).
- Branch protection on `main`: require the CI and ADR-validation checks to pass.

## What runs when

- **CI** (`ci.yml`) — on push to main and on PRs.
- **ADR validation** (`adr-validate.yml`) — on changes under `docs/decisions/`.
- **Security review** (`security-review.yml`) — on same-repo PRs (OAuth, deterministic FP-filtering).
- **Triage** (`issue-triage.yml`) — auto-labels/comments new issues & PRs; checks for ADR-breaking requests; opens PRs only when a maintainer comments `@claude implement`.
- **ls protocol replay regression** (`ls-replay-regression.yml`) — the self-heal merge gate; deterministic replay + bounded-surface check on `selfheal/*` PRs.

## 4. Going live (Firebase + Vertex + Cloud Run + WIF)

The codebase is complete and emulator-verified; bringing it up against real infrastructure is
a one-time provisioning pass. None of this is needed to run locally (`scripts/dev.sh`).

### 4a. Firebase project (irreversible region — decide first)

1. Create a Firebase project on the **Blaze** plan (required: Spark blocks outbound egress to
   ls-tc.de / Yahoo / Vertex, and Cloud Run / Scheduler / Secret Manager need Blaze).
2. Create Firestore and Realtime Database in **`europe-west3`** (ADR-0001). **Firestore's
   location is permanent** — get this right before any data exists.
3. Enable **Auth** providers: Email/Password + Google; configure the OAuth consent screen and
   authorized domains. Decide your invite-allowlist policy (this is an access-gated product).

### 4b. Gemini via Vertex AI (no API key)

- Enable the **Vertex AI API** in the project; grant the Functions runtime service account
  `roles/aiplatform.user`. Confirm `gemini-3.5-flash` availability/quota in `europe-west3`.
- Set `CANCRI_USE_VERTEX=true` for the deployed functions. There is no Gemini API key.

### 4c. Workload Identity Federation (keyless deploy)

`deploy.yml` authenticates via WIF — no stored JSON key. One-time setup:

1. A **WIF pool + provider** with an attribute-condition pinning `assertion.repository == 't11z/cancri'`.
2. A dedicated **deployer service account** (e.g. `cancri-deployer@<project>.iam.gserviceaccount.com`),
   granted `roles/iam.workloadIdentityUser` for your repo's `principalSet`, plus least-privilege
   deploy roles: `firebasehosting.admin`, `firebaserules.admin`, `firebasedatabase.admin`,
   `cloudfunctions.admin`, `run.admin`, `artifactregistry.writer`, `cloudbuild.builds.editor`,
   `iam.serviceAccountUser` (on the runtime SAs), `serviceusage.serviceUsageConsumer`.
3. An **Artifact Registry** Docker repo named `cancri` in your region.
4. Enable APIs: Cloud Run, Cloud Build, Artifact Registry, Secret Manager, Cloud Scheduler.
5. Set repo **Variables**: `GCP_PROJECT_ID`, `GCP_REGION` (default `europe-west3`),
   `WIF_PROVIDER`, `DEPLOYER_SA`, and finally `CANCRI_DEPLOY_ENABLED=true` to arm `deploy.yml`.

`firebase-tools` deploys Hosting/Functions/rules; `gcloud` builds + deploys the feed-engine
Cloud Run image (this split keeps the long-running deploy off the firebase-tools v15 ADC
timeout, #10726).

### 4d. The remaining live fills (flagged in code)

- **Secret Manager** entries for the L&S handshake config (`LS_cid`, magic/idle/polling params,
  origin) — never in the repo.
- The first **L&S capture** (the self-heal Job, during trading hours) fills
  `packages/ls-protocol/protocol.config.v1` with the real handshake bytes / frame offsets —
  exactly what the replay gate verifies.
- A **Playwright Dockerfile** for `services/selfheal`, then `gcloud run jobs deploy`.
- A **logo provider** behind `resolveLogo`'s fetcher (monogram-only until then).
- Branch-protect `main` to require the **replay-regression** check + ≥1 human review for
  self-heal PRs.
