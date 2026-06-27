#!/usr/bin/env bash
# cancri — one-shot quickstart.
#
# Boots the terminal locally against the in-browser mock feed: no Node on your
# host, no Firebase project, no secrets. The only host requirement is Docker.
# Everything runs inside a node:26 container (same image as scripts/dev.sh).
#
#   scripts/quickstart.sh
#
# then open http://localhost:5173 — the dev-only `// review` bar jumps between
# every screen (boot · auth · onboard · confirm · dash) and dashboard state
# (live · degraded · reconnect · closed · empty · error).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${CANCRI_NODE_IMAGE:-node:26-bookworm-slim}"
PORT="${CANCRI_DEV_PORT:-5173}"

# Terminal colours that echo the cancri palette (mint = ok, amber = note, rose = stop).
MINT=$'\033[38;2;54;249;208m'; AMBER=$'\033[38;2;255;210;63m'
ROSE=$'\033[38;2;255;82;119m'; DIM=$'\033[38;2;107;119;135m'; OFF=$'\033[0m'

say()  { printf '%s[ok]%s  %s\n'  "$MINT"  "$OFF" "$1"; }
note() { printf '%s[net]%s %s\n'  "$AMBER" "$OFF" "$1"; }
die()  { printf '%s[err]%s %s\n'  "$ROSE"  "$OFF" "$1" >&2; exit 1; }

printf '%s\n' "${DIM}[ok]  cancri // live-portfolio-terminal — quickstart${OFF}"

# 1. Docker is the only host dependency.
command -v docker >/dev/null 2>&1 || die \
  "Docker not found. Install Docker Desktop / Engine and re-run. (That is the ONLY host requirement.)"
docker info >/dev/null 2>&1 || die \
  "Docker is installed but not running. Start the Docker daemon and re-run."
say "docker present and running"

# 2. Port check (non-fatal — just a friendly heads-up).
if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  note "port $PORT looks busy — set CANCRI_DEV_PORT to override if the dev server can't bind."
fi

note "pulling deps + generating tokens in a node:26 container (first run is the slow one)…"
say  "when you see the vite banner, open ${MINT}http://localhost:${PORT}${OFF}"
echo

# 3. Hand off to the container. Mirrors scripts/dev.sh so there is one source of truth
#    for how the web app boots; the pnpm store is cached in a named volume across runs.
exec docker run --rm -it \
  -e CI=true \
  -v "$ROOT":/work \
  -v cancri-pnpm:/pnpm-store \
  -w /work \
  -p "${PORT}:5173" \
  "$IMAGE" bash -lc '
    npm i -g pnpm@11.9.0 >/dev/null 2>&1
    pnpm install --store-dir=/pnpm-store
    node tools/tokens/generate.mjs
    exec /work/apps/web/node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort
  '
