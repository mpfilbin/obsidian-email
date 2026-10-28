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

  it("ignores links whose state differs from the expected one", async () => {
    const r = new AuthRedirectReceiver();
    const waiting = r.waitForCode({ expectedState: "good" });
    r.handle({ code: "evil", state: "wrong" });
    r.handle({ error: "access_denied", state: "wrong" });
    r.handle({ code: "real", state: "good" });
    await expect(waiting).resolves.toEqual({ code: "real", state: "good" });
  });

  it("keeps the code and state out of error messages", async () => {
    const r = new AuthRedirectReceiver();
    const waiting = r.waitForCode();
    const expectation = expect(waiting).rejects.toSatisfy(
      (e: Error) => !e.message.includes("SECRETCODE") && !e.message.includes("SECRETSTATE"),
    );
    r.handle({ code: "SECRETCODE", state: "SECRETSTATE", error: "access_denied" });
    await expectation;
  });

  it("ignores redirects when no sign-in is in flight", () => {
    expect(() => new AuthRedirectReceiver().handle({ code: "c", state: "s" })).not.toThrow();
  });

  it("fails a pending sign-in when a newer one starts", async () => {
    const r = new AuthRedirectReceiver();
    const first = r.waitForCode();
    const firstExpectation = expect(first).rejects.toThrow("Superseded");
    const second = r.waitForCode();
    await firstExpectation;
    r.close(); // the superseded flow's cleanup must not cancel the new one
    r.handle({ code: "c", state: "s" });
    await expect(second).resolves.toEqual({ code: "c", state: "s" });
  });

  it("times out", async () => {
    await expect(new AuthRedirectReceiver().waitForCode({ timeoutMs: 10 })).rejects.toBeInstanceOf(AuthError);
  });
});
