#!/usr/bin/env bash
# Type-check every workspace package and produce the production web build,
# all inside a Node 26 container. No host Node required.
#
# Run from a shell that has Docker (e.g. the ClaudeCode WSL distro):
#   scripts/build.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${CANCRI_NODE_IMAGE:-node:26-bookworm-slim}"

exec docker run --rm \
  -e CI=true \
  -v "$ROOT":/work \
  -v cancri-pnpm:/pnpm-store \
  -w /work \
  "$IMAGE" bash -lc '
    npm i -g pnpm@11.9.0 >/dev/null 2>&1
    pnpm install --store-dir=/pnpm-store
    pnpm --filter @cancri/tokens-gen run generate
    pnpm -r --if-present run typecheck
    pnpm --filter @cancri/web build
  '
