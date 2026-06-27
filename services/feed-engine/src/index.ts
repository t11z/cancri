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
initializeApp();

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
feed.start();

const port = Number(process.env["PORT"] ?? 8080);
createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port);
