import { describe, it, expect, vi } from "vitest";
import { OAUTH_CONFIG } from "../../src/auth/provider-oauth-config";
import { buildAuthorizeUrl, exchangeCode, refreshAccessToken } from "../../src/auth/oauth-client";
import { AuthError } from "../../src/providers/types";

describe("buildAuthorizeUrl", () => {
  it("includes PKCE, state, scope and Google extras", () => {
    const url = new URL(buildAuthorizeUrl(OAUTH_CONFIG.gmail, {
      clientId: "cid", redirectUri: "http://127.0.0.1:5000",
      challenge: "chal", state: "st",
    }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("gmail.modify");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5000");
  });
});

describe("exchangeCode", () => {
  it("maps a token response", async () => {
    const post = vi.fn().mockResolvedValue({
      status: 200,
      json: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
    });
    const r = await exchangeCode(OAUTH_CONFIG["ms-graph"], post, {
      clientId: "cid", code: "c", verifier: "v", redirectUri: "http://localhost:5000",
    });
    expect(r).toEqual({ accessToken: "at", refreshToken: "rt", expiresInSec: 3600 });
    const [, form] = post.mock.calls[0];
    expect(form.grant_type).toBe("authorization_code");
    expect(form.code_verifier).toBe("v");
    expect(form.client_secret).toBeUndefined();
  });

  it("throws AuthError on invalid_grant", async () => {
    const post = vi.fn().mockResolvedValue({ status: 400, json: { error: "invalid_grant" } });
    await expect(exchangeCode(OAUTH_CONFIG.gmail, post, {
      clientId: "cid", clientSecret: "sec", code: "c", verifier: "v",
      redirectUri: "http://127.0.0.1:5000",
    })).rejects.toBeInstanceOf(AuthError);
  });
});

describe("refreshAccessToken", () => {
  it("sends grant_type=refresh_token and includes the Google secret", async () => {
    const post = vi.fn().mockResolvedValue({
      status: 200, json: { access_token: "at2", expires_in: 3599 },
    });
    const r = await refreshAccessToken(OAUTH_CONFIG.gmail, post, {
      clientId: "cid", clientSecret: "sec", refreshToken: "rt",
    });
    expect(r.accessToken).toBe("at2");
    expect(r.refreshToken).toBeUndefined();
    const [, form] = post.mock.calls[0];
    expect(form.grant_type).toBe("refresh_token");
    expect(form.client_secret).toBe("sec");
  });
});
