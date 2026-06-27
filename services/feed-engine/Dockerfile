# Cloud Run image for the always-on feed-engine.
# Build from the REPO ROOT (it needs the pnpm workspace):
#   docker build -f services/feed-engine/Dockerfile -t cancri-feed-engine .
FROM node:26-bookworm-slim AS build
WORKDIR /repo
RUN npm i -g pnpm@11.9.0
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cancri/feed-engine run build

FROM node:26-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# The esbuild bundle inlines the workspace packages and leaves these runtime deps
# external — install just them (versions pinned to services/feed-engine/package.json).
RUN npm init -y >/dev/null 2>&1 \
 && npm i --omit=dev firebase-admin@14.1.0 ws@8.21.0 protobufjs@8.6.5 \
 && npm cache clean --force
COPY --from=build /repo/services/feed-engine/lib ./lib
EXPOSE 8080
CMD ["node", "lib/index.js"]
