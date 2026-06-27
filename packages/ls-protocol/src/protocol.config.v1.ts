import type { ProtocolConfig } from "./types.js";

/**
 * Protocol config v1 — the structural baseline. Handshake magic values come from
 * brief Appendix A; the frame layout is a placeholder pending the first live
 * capture. A self-heal PR bumps this file (or adds v2) and pins it with a fixture.
 */
export const PROTOCOL_CONFIG_V1: ProtocolConfig = {
  version: "v1",
  handshake: {
    createSessionPath: "/lightstreamer/create_session.txt",
    lsCid: "PLACEHOLDER_LS_CID",
    adapterSet: "WALLSTREETONLINE",
    subprotocol: "TLCP-2.4.0.lightstreamer.com",
    origin: "https://www.ls-tc.de",
    idleMillis: 19000,
    pollMillis: 0,
  },
  frame: {
    updatePrefix: "U",
    delimiter: ",",
    idField: 1,
    priceField: 2,
    lineEnding: "\r\n",
  },
};
