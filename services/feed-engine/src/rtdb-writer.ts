import { getDatabase, type Database } from "firebase-admin/database";
import type { FeedStatus, Tick } from "@cancri/data-contracts";

/**
 * The sink the feed writes to. The feed-engine is the SOLE writer of normalised
 * ticks and feed status to RTDB (ADR-0004/0005); clients only ever read.
 */
export interface TickSink {
  writeTick(tick: Tick): Promise<void> | void;
  writeStatus(status: FeedStatus): Promise<void> | void;
}

export class RtdbWriter implements TickSink {
  constructor(private readonly db: Database) {}

  /** Overwrite-in-place at /quotes/{isin} — keeps storage flat (ADR-0004). */
  async writeTick(tick: Tick): Promise<void> {
    await this.db.ref(`quotes/${tick.instrumentId}`).set(tick);
  }

  async writeStatus(status: FeedStatus): Promise<void> {
    await this.db.ref("feed/status").set(status);
  }
}

export function rtdbWriterFromAdmin(): RtdbWriter {
  return new RtdbWriter(getDatabase());
}
