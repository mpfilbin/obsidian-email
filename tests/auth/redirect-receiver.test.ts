import { describe, it, expect } from "vitest";
import { AuthRedirectReceiver, AUTH_REDIRECT_URI } from "../../src/auth/redirect-receiver";
import { AuthError } from "../../src/providers/types";

describe("AuthRedirectReceiver", () => {
  it("reports the obsidian:// redirect URI", async () => {
    expect(await new AuthRedirectReceiver().listen()).toEqual({ redirectUri: AUTH_REDIRECT_URI });
    expect(AUTH_REDIRECT_URI).toBe("obsidian://obsidian-email-auth");
  });

  it("captures code and state from the protocol params", async () => {
    const r = new AuthRedirectReceiver();
    const waiting = r.waitForCode();
    r.handle({ action: "obsidian-email-auth", code: "abc", state: "xyz" });
    await expect(waiting).resolves.toEqual({ code: "abc", state: "xyz" });
  });

  it("rejects with AuthError when the provider returns error", async () => {
    const r = new AuthRedirectReceiver();
    const waiting = r.waitForCode();
    const expectation = expect(waiting).rejects.toBeInstanceOf(AuthError);
    r.handle({ error: "access_denied" });
    await expectation;
  });

  it("includes error_description in the rejection message when present", async () => {
    const r = new AuthRedirectReceiver();
    const waiting = r.waitForCode();
    const expectation = expect(waiting).rejects.toThrow(
      "Authorization failed: invalid_request: AADSTS50194: not multi-tenant",
    );
    r.handle({ error: "invalid_request", error_description: "AADSTS50194: not multi-tenant" });
    await expectation;
  });

  it("ignores stray links with neither code nor error", async () => {
    const r = new AuthRedirectReceiver();
    const waiting = r.waitForCode({ timeoutMs: 20 });
    r.handle({ action: "obsidian-email-auth" });
    await expect(waiting).rejects.toThrow("Timed out");
  });

  it("ignores redirects when no sign-in is in flight", () => {
    expect(() => new AuthRedirectReceiver().handle({ code: "c", state: "s" })).not.toThrow();
  });

  it("times out", async () => {
    await expect(new AuthRedirectReceiver().waitForCode({ timeoutMs: 10 })).rejects.toBeInstanceOf(AuthError);
  });
});
