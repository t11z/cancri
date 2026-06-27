import type { DecodedUpdate, ProtocolConfig, ProtocolModule, SessionParams } from "./types.js";
import { buildCreateSession, decodeFrame } from "./codec.js";
import { PROTOCOL_CONFIG_V1 } from "./protocol.config.v1.js";

export * from "./types.js";
export { PROTOCOL_CONFIG_V1 } from "./protocol.config.v1.js";
export { buildCreateSession, decodeFrame } from "./codec.js";

/** Assemble a protocol module from a config (config-driven; ADR-0009). */
export function makeProtocolModule(config: ProtocolConfig): ProtocolModule {
  return {
    config,
    buildCreateSession: (params: SessionParams): string => buildCreateSession(config, params),
    decodeFrame: (raw: string): DecodedUpdate | null => decodeFrame(config, raw),
  };
}

const REGISTRY: Record<string, ProtocolConfig> = {
  [PROTOCOL_CONFIG_V1.version]: PROTOCOL_CONFIG_V1,
};

/** The active protocol version; a self-heal PR points this at a new config. */
export const ACTIVE_PROTOCOL_VERSION = "v1";

export function getActiveProtocol(): ProtocolModule {
  const config = REGISTRY[ACTIVE_PROTOCOL_VERSION] ?? PROTOCOL_CONFIG_V1;
  return makeProtocolModule(config);
}
