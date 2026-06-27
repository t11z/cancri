import { describe, expect, test } from "vitest";
import { noProviderFetcher, resolveLogo } from "./logo.js";

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
