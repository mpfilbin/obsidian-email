import { describe, it, expect, vi } from "vitest";
import { OAUTH_CONFIG } from "../../src/auth/provider-oauth-config";
import { buildAuthorizeUrl, exchangeCode, refreshAccessToken } from "../../src/auth/oauth-client";
import { AuthError } from "../../src/providers/types";

describe("buildAuthorizeUrl", () => {
  it("includes PKCE, state, scope and the Graph endpoint", () => {
    const url = new URL(buildAuthorizeUrl(OAUTH_CONFIG["ms-graph"], {
      clientId: "cid", redirectUri: "http://localhost:5000",
      challenge: "chal", state: "st",
    }));
    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:5000");
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
    await expect(exchangeCode(OAUTH_CONFIG["ms-graph"], post, {
      clientId: "cid", code: "c", verifier: "v",
      redirectUri: "http://localhost:5000",
    })).rejects.toBeInstanceOf(AuthError);
  });

  it("includes error_description in the AuthError message when present", async () => {
    const post = vi.fn().mockResolvedValue({
      status: 400,
      json: { error: "invalid_request", error_description: "AADSTS50194: not multi-tenant" },
    });
    await expect(exchangeCode(OAUTH_CONFIG["ms-graph"], post, {
      clientId: "cid", code: "c", verifier: "v", redirectUri: "http://localhost:5000",
    })).rejects.toThrow("OAuth token request failed: invalid_request: AADSTS50194: not multi-tenant");
  });
});

describe("refreshAccessToken", () => {
  it("sends grant_type=refresh_token without a client secret", async () => {
    const post = vi.fn().mockResolvedValue({
      status: 200, json: { access_token: "at2", expires_in: 3599 },
    });
    const r = await refreshAccessToken(OAUTH_CONFIG["ms-graph"], post, {
      clientId: "cid", refreshToken: "rt",
    });
    expect(r.accessToken).toBe("at2");
    expect(r.refreshToken).toBeUndefined();
    const [, form] = post.mock.calls[0];
    expect(form.grant_type).toBe("refresh_token");
    expect(form.client_secret).toBeUndefined();
  });
});
