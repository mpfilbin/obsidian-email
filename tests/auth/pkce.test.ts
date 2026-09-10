import { describe, it, expect } from "vitest";
import { randomUrlSafe, pkceChallenge, newPkcePair, newState } from "../../src/auth/pkce";

describe("pkce", () => {
  it("randomUrlSafe returns url-safe chars only and varies", () => {
    const a = randomUrlSafe(32);
    const b = randomUrlSafe(32);
    expect(a).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it("pkceChallenge matches the RFC 7636 test vector", async () => {
    // RFC 7636 Appendix B
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await pkceChallenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("newPkcePair produces a verifier whose challenge is reproducible", async () => {
    const { verifier, challenge } = await newPkcePair();
    expect(await pkceChallenge(verifier)).toBe(challenge);
  });

  it("newState is url-safe and long", () => {
    expect(newState()).toMatch(/^[A-Za-z0-9\-_]{22,}$/);
  });
});
