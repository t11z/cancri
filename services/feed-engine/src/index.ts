import { createServer } from "node:http";
import { initializeApp } from "firebase-admin/app";
import { rtdbWriterFromAdmin } from "./rtdb-writer.js";
import { FeedOrchestrator } from "./feed-orchestrator.js";
import { FeedStateMachine } from "./feed-state.js";
import { SanityOracle } from "./sanity-oracle.js";
import { LsSourceAdapter } from "./ls-adapter.js";
import { YahooSourceAdapter } from "./yahoo/yahoo-adapter.js";

/**
 * Feed-engine service entry (Cloud Run, ADR-0002/0003). Wires the L&S primary +
 * Yahoo fallback adapters, the sanity oracle and the degradation FSM into the sole
 * RTDB writer via the FeedOrchestrator, and exposes /healthz. The id-maps and
 * previousClose are stubs until the L&S instrument-search resolver and the daily
 * Yahoo close-read land; both live sockets are inert until the first capture
 * (Phase 6).
 */
// firebase-admin cannot derive the RTDB URL for non-US regions: it reads the URL
// from the `databaseURL` option (or the FIREBASE_CONFIG JSON), not a bare env var,
// so getDatabase() throws synchronously without it. Pass it explicitly from the
// FIREBASE_DATABASE_URL the deploy injects as a Cloud Run env var. When unset
// (e.g. the RTDB emulator with FIREBASE_DATABASE_EMULATOR_HOST), this is undefined
// and initializeApp falls back to its normal resolution.
initializeApp({
  databaseURL: process.env["FIREBASE_DATABASE_URL"],
});

// This service is the sole, always-on RTDB writer and its writes are fire-and-forget
// (the orchestrator voids the write promises). A transient RTDB error surfaces as an
// unhandled rejection, which Node would turn into a process exit — tearing down the
// writer over one failed write. Log and keep streaming instead.
process.on("unhandledRejection", (reason) => {
  console.error("feed-engine: unhandled rejection", reason);
});

const primary = new LsSourceAdapter({
  isinForId: (id) => id, // TODO: L&S instrument-search id-map.
  previousClose: () => 0, // TODO: daily Yahoo previousClose read.
});
const fallback = new YahooSourceAdapter({
  isinForYahooId: (id) => id, // TODO: venue-suffix inverse.
  previousClose: () => 0,
});
const feed = new FeedOrchestrator(
  primary,
  fallback,
  new SanityOracle(),
  rtdbWriterFromAdmin(),
  new FeedStateMachine(),
);

// Bind the health port FIRST so Cloud Run sees the container listening within the
// startup deadline; only then begin streaming (which kicks off the RTDB writes).
const port = Number(process.env["PORT"] ?? 8080);
createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port, () => {
  feed.start();
});
