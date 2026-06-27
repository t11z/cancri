// Bundle the feed-engine service for Cloud Run. Inlines the workspace contract;
// leaves runtime-heavy deps (firebase-admin, ws) external (installed in the image).
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: "lib/index.js",
  external: ["firebase-admin", "ws", "protobufjs"],
});

console.log("feed-engine: bundled lib/index.js");
