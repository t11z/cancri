import { createServer } from "node:http";
import { initializeApp } from "firebase-admin/app";
import { rtdbWriterFromAdmin } from "./rtdb-writer.js";
import { FeedManager } from "./feed-manager.js";
import { LsSourceAdapter } from "./ls-adapter.js";

/**
 * Feed-engine service entry (Cloud Run, ADR-0002/0003). Phase 4 scaffold: wires
 * the L&S adapter to the sole RTDB writer behind the FeedManager, and exposes a
 * /healthz endpoint. The id-map and previousClose are stubs until the L&S
 * instrument-search resolver and the daily Yahoo close-read land (Phase 4/5), and
 * the L&S socket itself is inert until the first live capture (Phase 6).
 */
initializeApp();

const adapter = new LsSourceAdapter({
  isinForId: (id) => id, // TODO(Phase 4): L&S instrument-search id-map.
  previousClose: () => 0, // TODO(Phase 5): daily Yahoo previousClose read.
});
const feed = new FeedManager(adapter, rtdbWriterFromAdmin());
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
