/**
 * The L&S break surface (ADR-0009, brief Appendix A), expressed as data so a
 * protocol change is ideally a config bump — and so the self-healing fix is
 * confined to exactly these three concerns: handshake, frame decode, id mapping.
 *
 * IMPORTANT: the concrete byte values / frame layout below are a STRUCTURAL
 * placeholder. The real Lightstreamer-6 (TLCP) handshake magic, frame offsets and
 * id remapping are filled from the first live capture (Phase 6 capture-and-diff);
 * this module exists so that capture has a precise, versioned target.
 */

/** How a raw update frame is parsed into (instrument-id, price). */
export interface FrameSpec {
  /** Lines that begin with this token carry a price update. */
  readonly updatePrefix: string;
  /** Field delimiter within a frame line. */
  readonly delimiter: string;
  /** Zero-based field index holding the source's internal instrument id. */
  readonly idField: number;
  /** Zero-based field index holding the price. */
  readonly priceField: number;
  /** Required line ending on the wire (L&S demands CRLF). */
  readonly lineEnding: string;
}

/** Parameters that go into the create_session handshake (the magic values). */
export interface HandshakeSpec {
  readonly createSessionPath: string;
  /** Client-identification magic value (LS_cid). */
  readonly lsCid: string;
  /** Adapter set, e.g. "WALLSTREETONLINE". */
  readonly adapterSet: string;
  /** Required WebSocket subprotocol. */
  readonly subprotocol: string;
  /** Required Origin header. */
  readonly origin: string;
  readonly idleMillis: number;
  readonly pollMillis: number;
}

export interface ProtocolConfig {
  readonly version: string;
  readonly handshake: HandshakeSpec;
  readonly frame: FrameSpec;
}

export interface DecodedUpdate {
  /** The source's internal instrument id (not the ISIN — mapped separately). */
  readonly id: string;
  readonly price: number;
}

export interface SessionParams {
  readonly user?: string;
  readonly password?: string;
}

/**
 * A self-contained, swappable protocol implementation. The socket lifecycle,
 * fan-out and health code depend only on this interface — never on decode details.
 */
export interface ProtocolModule {
  readonly config: ProtocolConfig;
  /** Build the create_session request body for the handshake. */
  buildCreateSession(params: SessionParams): string;
  /** Decode one raw frame line into an update, or null if it is not an update. */
  decodeFrame(raw: string): DecodedUpdate | null;
}
