import type { DecodedUpdate, ProtocolConfig, SessionParams } from "./types.js";

/**
 * Pure codec — the only place that knows the wire format. Both functions are
 * total and side-effect-free so they can be exercised by offline replay against
 * recorded fixtures (the self-heal verification primitive, ADR-0010).
 */
export function buildCreateSession(config: ProtocolConfig, params: SessionParams): string {
  const h = config.handshake;
  const fields: Record<string, string> = {
    LS_op2: "create_session",
    LS_cid: h.lsCid,
    LS_adapter_set: h.adapterSet,
    LS_polling: h.pollMillis > 0 ? "true" : "false",
    LS_polling_millis: String(h.pollMillis),
    LS_idle_millis: String(h.idleMillis),
  };
  if (params.user !== undefined) fields["LS_user"] = params.user;
  if (params.password !== undefined) fields["LS_password"] = params.password;
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

export function decodeFrame(config: ProtocolConfig, raw: string): DecodedUpdate | null {
  const f = config.frame;
  const line = raw.replace(/\r?\n$/, "");
  if (!line.startsWith(f.updatePrefix + f.delimiter) && line !== f.updatePrefix) return null;

  const parts = line.split(f.delimiter);
  const id = parts[f.idField];
  const priceRaw = parts[f.priceField];
  if (id === undefined || priceRaw === undefined) return null;

  const price = Number.parseFloat(priceRaw);
  if (!Number.isFinite(price)) return null;

  return { id, price };
}
