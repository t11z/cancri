import { HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { z } from "zod";

/**
 * Gemini access (ADR-0008). The LLM proposes a structured inventory; a
 * deterministic resolver disposes (ISIN checksum here, L&S search in Phase 4).
 * Two implementations behind one interface: the real Vertex client (no API key —
 * service-account IAM), and a deterministic mock used in tests and local dev so
 * the whole pipeline runs without a project.
 */
export interface RawProposal {
  name: string;
  symbol: string;
  isin?: string;
  quantity: number;
  costBasis?: number;
  confidence: number;
  uncertaintyNote?: string;
}

export interface GeminiClient {
  normalise(text: string): Promise<RawProposal[]>;
}

const RawProposalSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  isin: z.string().optional(),
  quantity: z.number(),
  costBasis: z.number().optional(),
  confidence: z.number(),
  uncertaintyNote: z.string().optional(),
});
const RawProposalArray = z.array(RawProposalSchema);

const SYSTEM_PROMPT = `You normalise a messy portfolio description into a structured inventory.
Return ONLY a JSON array; each element: {"name","symbol","isin"(optional),"quantity","costBasis"(optional),"confidence"(0..1),"uncertaintyNote"(optional)}.
Rules:
- Resolve each holding to its ticker symbol and, when you are confident, its ISIN. Do NOT fabricate an ISIN; omit it if unsure.
- confidence reflects how sure you are about the whole row (identity + quantity). If the quantity is vague ("some", "a few"), set quantity to your best guess, lower confidence, and explain in uncertaintyNote.
- One element per distinct instrument. No prose, no markdown — JSON only.`;

class VertexGemini implements GeminiClient {
  // Lazily imported so @google/genai (and its google-auth metadata probing) never
  // loads on the mock/discovery path — only when the real Vertex call is made.
  private client: Promise<import("@google/genai").GoogleGenAI> | null = null;

  constructor(
    private readonly project: string,
    private readonly location: string,
    private readonly model: string,
  ) {}

  private getClient(): Promise<import("@google/genai").GoogleGenAI> {
    if (this.client === null) {
      this.client = import("@google/genai").then(
        (m) => new m.GoogleGenAI({ vertexai: true, project: this.project, location: this.location }),
      );
    }
    return this.client;
  }

  async normalise(text: string): Promise<RawProposal[]> {
    const ai = await this.getClient();

    // The model call: reachability/region/IAM failures land here. ADR-0008 says a
    // degraded intake surfaces honestly — so we log the real cause server-side and
    // re-raise as a typed HttpsError ("unavailable") instead of letting a raw throw
    // become an opaque `internal`/HTTP 500 with no signal for the caller.
    let raw: string;
    try {
      const res = await ai.models.generateContent({
        model: this.model,
        contents: `${SYSTEM_PROMPT}\n\nINPUT:\n${text}`,
        config: { responseMimeType: "application/json", temperature: 0 },
      });
      raw = res.text ?? "[]";
    } catch (cause) {
      logger.error("Vertex generateContent failed", {
        model: this.model,
        project: this.project,
        location: this.location,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      throw new HttpsError(
        "unavailable",
        "the portfolio reader is temporarily unreachable — please try again in a moment",
      );
    }

    // The model replied, but not with the shape we asked for (bad JSON, or JSON
    // that fails the schema). That's a model-output fault, not user input — flag it
    // distinctly so it never silently produces an empty or malformed book.
    try {
      return RawProposalArray.parse(JSON.parse(raw));
    } catch (cause) {
      logger.error("Vertex returned an unparseable proposal", {
        model: this.model,
        error: cause instanceof Error ? cause.message : String(cause),
        sample: raw.slice(0, 500),
      });
      throw new HttpsError(
        "internal",
        "the portfolio reader returned an unexpected response — please try again",
      );
    }
  }
}

interface KnownInstrument {
  symbol: string;
  isin?: string;
  name: string;
}

const KNOWN: Record<string, KnownInstrument> = {
  aapl: { symbol: "AAPL", isin: "US0378331005", name: "Apple Inc." },
  apple: { symbol: "AAPL", isin: "US0378331005", name: "Apple Inc." },
  msft: { symbol: "MSFT", isin: "US5949181045", name: "Microsoft Corp." },
  microsoft: { symbol: "MSFT", isin: "US5949181045", name: "Microsoft Corp." },
  nvda: { symbol: "NVDA", isin: "US67066G1040", name: "NVIDIA Corp." },
  nvidia: { symbol: "NVDA", isin: "US67066G1040", name: "NVIDIA Corp." },
  amzn: { symbol: "AMZN", isin: "US0231351067", name: "Amazon.com" },
  amazon: { symbol: "AMZN", isin: "US0231351067", name: "Amazon.com" },
  pltr: { symbol: "PLTR", isin: "US69608A1088", name: "Palantir Tech." },
  palantir: { symbol: "PLTR", isin: "US69608A1088", name: "Palantir Tech." },
  btc: { symbol: "BTC", name: "Bitcoin" },
  eth: { symbol: "ETH", name: "Ethereum" },
};

/**
 * Deterministic stand-in for Gemini: parses simple "<qty> <symbol>" /
 * "<symbol> <qty>" patterns against a small known-instrument table. Enough to
 * exercise the full pipeline offline; the real model handles genuine mess.
 */
export class MockGemini implements GeminiClient {
  async normalise(text: string): Promise<RawProposal[]> {
    const out: RawProposal[] = [];
    for (const chunk of text.split(/[,\n]/)) {
      const t = chunk.trim().toLowerCase();
      if (t === "") continue;
      let hit: KnownInstrument | undefined;
      for (const key of Object.keys(KNOWN)) {
        if (t.includes(key)) {
          hit = KNOWN[key];
          break;
        }
      }
      if (hit === undefined) continue;
      const numMatch = t.match(/(\d+(?:\.\d+)?)/);
      const hasQty = numMatch !== null;
      const quantity = hasQty ? Number.parseFloat(numMatch[1] as string) : 0;
      out.push({
        name: hit.name,
        symbol: hit.symbol,
        ...(hit.isin !== undefined ? { isin: hit.isin } : {}),
        quantity,
        confidence: hasQty ? (hit.isin !== undefined ? 0.95 : 0.9) : 0.4,
        ...(hasQty ? {} : { uncertaintyNote: "quantity unclear — please confirm" }),
      });
    }
    return out;
  }
}

/**
 * Pick the client for the current runtime.
 *
 * Deployed, we call the real model and let a failure surface honestly to the
 * caller (ADR-0008: "degraded normalisation surfaces as a clarify/error state,
 * never a silent bad write"). We deliberately do NOT fall back to the
 * deterministic parser in production: the offline parser only knows a dozen
 * symbols, so degrading to it would silently drop most of a real portfolio and
 * present a mangled book as if it were authoritative — the opposite of honest.
 *
 * The mock stands in only where there is no real model to call: the Functions
 * emulator, unit tests, and any environment with Vertex explicitly disabled or
 * no project configured. The default is therefore "real model when one is
 * reachable" — a missing env flag can no longer silently route production
 * through the 12-symbol parser.
 */
export function getGeminiClient(): GeminiClient {
  const project = process.env["GOOGLE_CLOUD_PROJECT"] ?? process.env["GCLOUD_PROJECT"] ?? "";
  const inEmulator = process.env["FUNCTIONS_EMULATOR"] === "true";
  const useVertex =
    process.env["CANCRI_USE_VERTEX"] !== "false" && !inEmulator && project !== "";
  if (!useVertex) return new MockGemini();
  return new VertexGemini(
    project,
    process.env["CANCRI_VERTEX_LOCATION"] ?? "europe-west1",
    process.env["CANCRI_GEMINI_MODEL"] ?? "gemini-3.5-flash",
  );
}
