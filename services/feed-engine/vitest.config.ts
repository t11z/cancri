import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@cancri/data-contracts": fileURLToPath(
        new URL("../../packages/data-contracts/src/index.ts", import.meta.url),
      ),
    },
  },
});
