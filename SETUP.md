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

All commands below need the **gcloud CLI** and **firebase-tools**, authenticated as a
project **Owner**. These are admin actions that the CI deployer SA deliberately *cannot*
do (least privilege — see §4c); run them once, by hand. Set these shell variables first
and reuse them throughout:

```bash
export PROJECT_ID=your-project-id    # your Firebase/GCP project id
export REGION=europe-west1          # Firestore, Cloud Run, Functions, Storage, Job, Vertex (ADR-0001)
export RTDB_LOCATION=europe-west1   # RTDB exists ONLY in us-central1 / europe-west1 / asia-southeast1
gcloud config set project "$PROJECT_ID"
```

### 4a. Firebase project (irreversible region — decide first)

1. Create a Firebase project on the **Blaze** plan (required: Spark blocks outbound egress to
   ls-tc.de / Yahoo / Vertex, and Cloud Run / Scheduler / Secret Manager need Blaze).
2. Create Firestore and Realtime Database in **`europe-west1`** (ADR-0001). **Firestore's and
   RTDB's locations are permanent** — get this right before any data exists. RTDB is *not*
   offered in `europe-west3`; `europe-west1` (Belgium) is the nearest RTDB-supporting EU region.
3. Enable **Auth** providers: Email/Password + Google; configure the OAuth consent screen and
   authorized domains. Decide your invite-allowlist policy (this is an access-gated product).

```bash
# Link a billing account (Blaze):
gcloud billing accounts list
gcloud billing projects link "$PROJECT_ID" --billing-account=XXXXXX-XXXXXX-XXXXXX

# Enable the APIs the stack needs, UP FRONT as Owner. firebase deploy tries to
# auto-enable missing APIs, but the least-privilege deployer SA (§4c) can't, so it
# fails with "Permissions denied enabling <api>". Enabling them here avoids that.
# eventarc + pubsub are required by 2nd-gen Cloud Functions (they deploy on Cloud
# Run via Eventarc); cloudbilling/storage/logging are checked/used by the deploy.
gcloud services enable \
  firestore.googleapis.com firebasedatabase.googleapis.com \
  cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  eventarc.googleapis.com pubsub.googleapis.com \
  cloudbilling.googleapis.com storage.googleapis.com logging.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com \
  cloudscheduler.googleapis.com aiplatform.googleapis.com

# Firestore (native mode) — PERMANENT location:
gcloud firestore databases create --location="$REGION"

# Realtime Database DEFAULT instance — PERMANENT location.
# NOTE: `firebase database:instances:create` only creates *additional* instances;
# it cannot create the first/default one and errors with
# "run firebase init database". Create the default instance the once via the CLI
# wizard (pick "europe-west1 (Belgium)" when prompted)...
firebase init database --project "$PROJECT_ID"
# ...or in the Firebase Console → Build → Realtime Database → Create Database →
# region "Belgium (europe-west1)".
# → URL: https://<PROJECT_ID>-default-rtdb.europe-west1.firebasedatabase.app
#   set this as the VITE_FIREBASE_DATABASE_URL build var for apps/web.
```

`$RTDB_LOCATION` is still the location you must choose in that wizard/console step.
Auth providers are configured in the **Firebase Console → Authentication** (no clean CLI).

### 4b. Gemini via Vertex AI (no API key)

- Enable the **Vertex AI API** in the project; grant the Functions runtime service account
  `roles/aiplatform.user`. Confirm `gemini-3.5-flash` availability/quota in `europe-west1`.
- Set `CANCRI_USE_VERTEX=true` for the deployed functions. There is no Gemini API key.

```bash
gcloud services enable aiplatform.googleapis.com

# 2nd-gen Functions run on Cloud Run and use the Compute Engine default SA unless
# overridden — confirm your functions' runtime SA, then grant it Vertex access:
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

`CANCRI_USE_VERTEX`, `CANCRI_VERTEX_LOCATION` (=`europe-west1`) and `CANCRI_GEMINI_MODEL` are
**Functions runtime env vars**, not GitHub values — set them in a committed `functions/.env`
(no secrets in them), which `firebase deploy --only functions` reads automatically.

### 4c. Workload Identity Federation (keyless deploy)

`deploy.yml` authenticates via WIF — no stored JSON key. One-time setup:

1. A **WIF pool + provider** with an attribute-condition pinning `assertion.repository == 't11z/cancri'`.
2. A dedicated **deployer service account** (e.g. `cancri-deployer@<project>.iam.gserviceaccount.com`),
   granted `roles/iam.workloadIdentityUser` for your repo's `principalSet`, plus least-privilege
   deploy roles: `firebasehosting.admin`, `firebaserules.admin`, `firebasedatabase.admin`,
   `cloudfunctions.admin`, `run.admin`, `artifactregistry.writer`, `cloudbuild.builds.editor`,
   `iam.serviceAccountUser` (on the runtime SAs), `serviceusage.serviceUsageConsumer`.
3. An **Artifact Registry** Docker repo named `cancri` in your region.
4. Enable APIs: Cloud Run, Cloud Build, Artifact Registry, Secret Manager, Cloud Scheduler
   (covered by the `gcloud services enable` in §4a).

```bash
# WIF pool + provider, pinned to this repo:
gcloud iam workload-identity-pools create github-pool \
  --location=global --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global --workload-identity-pool=github-pool \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='t11z/cancri'"

# Deployer SA + least-privilege roles:
gcloud iam service-accounts create cancri-deployer --display-name="cancri CI deployer"
SA="cancri-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
for role in \
  roles/firebasehosting.admin roles/firebaserules.admin roles/firebasedatabase.admin \
  roles/cloudfunctions.admin roles/run.admin roles/artifactregistry.writer \
  roles/cloudbuild.builds.editor roles/iam.serviceAccountUser \
  roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$role"
done

# Let GitHub Actions for THIS repo impersonate the deployer SA:
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/t11z/cancri"

# Artifact Registry Docker repo (feed-engine image target):
gcloud artifacts repositories create cancri --repository-format=docker --location="$REGION"

# The value to paste into the WIF_PROVIDER repo Variable:
echo "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
```

5. Set the repo **Variables** — **Settings → Secrets and variables → Actions → `Variables`
   tab** (these are NOT secrets; `deploy.yml` reads `${{ vars.* }}`, so a value placed under
   the *Secrets* tab resolves to empty and the deploy fails at the WIF auth step):
   `GCP_PROJECT_ID`, `GCP_REGION` (default `europe-west1`), `WIF_PROVIDER`, `DEPLOYER_SA`,
   and finally `CANCRI_DEPLOY_ENABLED=true` to arm `deploy.yml`.
6. Set the **web client config** as repo Variables too — Vite bakes these into the client
   bundle at build time (they are public, protected by security rules; not secrets). Get the
   values from **Firebase Console → Project settings → Your apps → Web app SDK config**:
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_APP_ID`, and `VITE_FIREBASE_DATABASE_URL`
   (`https://<project>-default-rtdb.europe-west1.firebasedatabase.app`). Without them the
   deployed app falls back to the `demo-cancri` config in `apps/web/src/firebase.ts`.

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
