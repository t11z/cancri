import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Workspace packages are aliased straight to their TS source so the whole app is
// one esbuild graph — no per-package build step, dev and build stay in sync.
const src = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@cancri/data-contracts": src("../../packages/data-contracts/src/index.ts"),
      "@cancri/sim-source": src("../../packages/sim-source/src/index.ts"),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
