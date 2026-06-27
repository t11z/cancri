import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Workspace contracts resolved to source. Generous timeouts: the Functions
// emulator cold-loads firebase-admin from node_modules on the Windows-mounted
// drive (drvfs), which is slow on the first callable invocation.
const src = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@cancri/data-contracts": src("../../packages/data-contracts/src/index.ts"),
      "@cancri/sim-source": src("../../packages/sim-source/src/index.ts"),
    },
  },
  test: {
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
