// Bundle the Cloud Functions for the emulator and deploy. esbuild inlines the
// workspace contract (@cancri/data-contracts) + zod and leaves the heavy,
// runtime-provided deps external (resolved from functions/node_modules).
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: "lib/index.js",
  external: ["firebase-functions", "firebase-admin", "@google/genai", "exceljs"],
});

console.log("functions: bundled lib/index.js");
