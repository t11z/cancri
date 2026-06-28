import { afterEach, describe, expect, test, vi } from "vitest";
import { clearbitFetcher, noProviderFetcher, resolveLogo } from "./logo.js";

describe("resolveLogo (brief §E)", () => {
  test("returns the resolved url when the provider has a logo", async () => {
    const r = await resolveLogo({ symbol: "AAPL", domain: "apple.com" }, async () => "https://cdn/apple.png");
    expect(r).toEqual({ state: "resolved", url: "https://cdn/apple.png" });
  });

  test("signals a monogram (never an image) when there is no domain", async () => {
    const r = await resolveLogo({ symbol: "BTC" }, noProviderFetcher);
    expect(r.state).toBe("monogram");
    if (r.state === "monogram") {
      expect(r.initials).toBe("BTC");
      expect(r.accent).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("signals a monogram when the provider misses; initials per the handover rule", async () => {
    const r = await resolveLogo({ symbol: "GOOGL", domain: "abc.xyz" }, async () => null);
    expect(r.state).toBe("monogram");
    if (r.state === "monogram") expect(r.initials).toBe("GOO"); // len > 3 → first 3
  });

  test("accent is stable per identity", async () => {
    const a = await resolveLogo({ symbol: "NVDA" }, noProviderFetcher);
    const b = await resolveLogo({ symbol: "NVDA" }, noProviderFetcher);
    expect(a).toEqual(b);
  });
});

describe("clearbitFetcher (ADR-0014) — verify before resolving", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (init: { ok: boolean; contentType: string }): void => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: init.ok,
        headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? init.contentType : null) },
      })),
    );
  };

  test("returns the provider URL when the response is an image", async () => {
    stubFetch({ ok: true, contentType: "image/png" });
    expect(await clearbitFetcher("apple.com")).toBe("https://logo.clearbit.com/apple.com");
  });

  test("returns null when the provider 404s (no logo)", async () => {
    stubFetch({ ok: false, contentType: "text/html" });
    expect(await clearbitFetcher("nope.invalid")).toBeNull();
  });

  test("returns null when the body is not an image", async () => {
    stubFetch({ ok: true, contentType: "text/html" });
    expect(await clearbitFetcher("nope.invalid")).toBeNull();
  });

  test("returns null instead of throwing when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await clearbitFetcher("apple.com")).toBeNull();
  });
});
