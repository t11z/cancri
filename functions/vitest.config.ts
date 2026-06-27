import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve the workspace contract to source so tests run without a build step.
export default defineConfig({
  resolve: {
    alias: {
      "@cancri/data-contracts": fileURLToPath(
        new URL("../packages/data-contracts/src/index.ts", import.meta.url),
      ),
    },
  },
});
