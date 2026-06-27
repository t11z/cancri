#!/usr/bin/env bash
# cancri — manual Firebase deploy from your machine.
#
# This is the hands-on counterpart to the keyless CI deploy in
# .github/workflows/deploy.yml (which uses Workload Identity Federation and also
# rolls the Cloud Run feed-engine). Use THIS script for a quick manual push of the
# Firebase surfaces — Hosting + Functions + Firestore/RTDB rules — from a laptop.
#
# Everything runs inside a node:26 container; the host only needs Docker. The
# feed-engine Cloud Run image is NOT built here (see SETUP.md §4 / the docs site
# "Deploy" page for the full going-live runway).
#
#   FIREBASE_PROJECT=your-project-id scripts/deploy.sh
#
# Auth, pick one:
#   • CI / non-interactive:  export FIREBASE_TOKEN="$(firebase login:ci)"  (then run)
#   • interactive:           the script will run `firebase login` inside the container
#
# Scope can be narrowed:  CANCRI_DEPLOY_ONLY=hosting scripts/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${CANCRI_NODE_IMAGE:-node:26-bookworm-slim}"
ONLY="${CANCRI_DEPLOY_ONLY:-hosting,functions,firestore:rules,database}"
FIREBASE_TOOLS_VERSION="15.22.3" # pinned to match deploy.yml / CI

MINT=$'\033[38;2;54;249;208m'; ROSE=$'\033[38;2;255;82;119m'; DIM=$'\033[38;2;107;119;135m'; OFF=$'\033[0m'
die() { printf '%s[err]%s %s\n' "$ROSE" "$OFF" "$1" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "Docker not found. Install Docker and re-run."
: "${FIREBASE_PROJECT:?Set FIREBASE_PROJECT to your Firebase project id (e.g. FIREBASE_PROJECT=cancri-prod scripts/deploy.sh)}"

# Interactive login needs a TTY; token-based deploy does not.
DOCKER_TTY=(-i); AUTH_NOTE="interactive firebase login (a browser URL will be printed)"
if [ -n "${FIREBASE_TOKEN:-}" ]; then AUTH_NOTE="FIREBASE_TOKEN (non-interactive)"; else DOCKER_TTY=(-it); fi

printf '%s\n' "${DIM}[ok]  cancri // deploy → project ${MINT}${FIREBASE_PROJECT}${OFF}${DIM} · only=${ONLY} · auth=${AUTH_NOTE}${OFF}"

exec docker run --rm "${DOCKER_TTY[@]}" \
  -e CI=true \
  -e FIREBASE_TOKEN="${FIREBASE_TOKEN:-}" \
  -e FIREBASE_PROJECT="$FIREBASE_PROJECT" \
  -e DEPLOY_ONLY="$ONLY" \
  -e FB_VERSION="$FIREBASE_TOOLS_VERSION" \
  -v "$ROOT":/work \
  -v cancri-pnpm:/pnpm-store \
  -w /work \
  "$IMAGE" bash -lc '
    set -euo pipefail
    npm i -g pnpm@11.9.0 "firebase-tools@${FB_VERSION}" >/dev/null 2>&1
    pnpm install --store-dir=/pnpm-store
    pnpm --filter @cancri/tokens-gen run generate
    pnpm --filter @cancri/web build
    pnpm --filter @cancri/functions run build
    if [ -z "${FIREBASE_TOKEN:-}" ]; then firebase login; fi
    firebase deploy --only "$DEPLOY_ONLY" --project "$FIREBASE_PROJECT" --non-interactive
  '
