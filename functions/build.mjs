// Bundle the Cloud Functions for the emulator and deploy. esbuild inlines the
// workspace contract (@cancri/data-contracts) + zod and leaves the heavy,
// runtime-provided deps external (resolved from functions/node_modules).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: "lib/index.js",
  // Resolve the workspace contract straight to source (mirrors
  // functions/vitest.config.ts and the tsconfig `paths`) so it is inlined into
  // the bundle and need not be a runtime dependency. This keeps `workspace:*`
  // out of the deployed package.json — the Cloud Functions buildpack runs npm,
  // which cannot parse the pnpm `workspace:` protocol (EUNSUPPORTEDPROTOCOL).
  alias: {
    "@cancri/data-contracts": fileURLToPath(
      new URL("../packages/data-contracts/src/index.ts", import.meta.url),
    ),
  },
  external: ["firebase-functions", "firebase-admin", "@google/genai", "exceljs"],
});

console.log("functions: bundled lib/index.js");
