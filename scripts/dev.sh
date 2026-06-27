#!/usr/bin/env bash
# Run the cancri web app in a Node 26 container — no Node needed on the host.
#
# Run this from a shell that has Docker (e.g. the ClaudeCode WSL distro):
#   scripts/dev.sh
# then open http://localhost:5173  (the // review bar lets you jump to any
# screen / dashboard state; it is dev-only and never ships).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${CANCRI_NODE_IMAGE:-node:26-bookworm-slim}"

exec docker run --rm -it \
  -e CI=true \
  -v "$ROOT":/work \
  -v cancri-pnpm:/pnpm-store \
  -w /work \
  -p 5173:5173 \
  "$IMAGE" bash -lc '
    npm i -g pnpm@11.9.0 >/dev/null 2>&1
    pnpm install --store-dir=/pnpm-store
    node tools/tokens/generate.mjs
    exec /work/apps/web/node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort
  '
