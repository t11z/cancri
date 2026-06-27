import protobuf from "protobufjs";

/**
 * Yahoo's streaming frames are protobuf-encoded `PricingData` (brief Appendix B).
 * The schema is community-maintained (yliveticker / yflive); we vendor a minimal
 * descriptor inline (so it bundles) covering the fields cancri needs. A tiny
 * encode/decode regression guards the codec — "a guard for the guard" — since a
 * silent upstream schema change would otherwise break the sanity oracle.
 */
const root = protobuf.Root.fromJSON({
  nested: {
    PricingData: {
      fields: {
        id: { type: "string", id: 1 },
        price: { type: "float", id: 2 },
        time: { type: "sint64", id: 3 },
        currency: { type: "string", id: 4 },
        exchange: { type: "string", id: 5 },
        quoteType: { type: "int32", id: 6 },
        marketHours: { type: "int32", id: 7 },
        changePercent: { type: "float", id: 8 },
        dayVolume: { type: "sint64", id: 9 },
        change: { type: "float", id: 10 },
      },
    },
  },
});

const PricingData = root.lookupType("PricingData");

export interface YahooQuote {
  readonly id: string;
  readonly price: number;
  readonly exchange?: string;
}

export function decodeYahooFrame(base64: string): YahooQuote {
  const buffer = Buffer.from(base64, "base64");
  const message = PricingData.decode(buffer);
  const obj = PricingData.toObject(message, { defaults: true }) as {
    id: string;
    price: number;
    exchange?: string;
  };
  return { id: obj.id, price: obj.price, exchange: obj.exchange };
}

/** Used only by the codec regression to produce a known frame. */
export function encodeYahooFrame(quote: YahooQuote): string {
  const message = PricingData.create(quote);
  return Buffer.from(PricingData.encode(message).finish()).toString("base64");
}
