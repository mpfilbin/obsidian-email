import { describe, it, expect, vi } from "vitest";
import { addAccount } from "../../src/auth/add-account";
import { buildAuthorizeUrl } from "../../src/auth/oauth-client";
import { OAUTH_CONFIG } from "../../src/auth/provider-oauth-config";
import { AuthError } from "../../src/providers/types";

function makeLoopbackFactory(codeResult: { code: string; state: string } | Error) {
  return () => ({
    listen: async () => ({ port: 5555, redirectUri: "http://127.0.0.1:5555" }),
    waitForCode: async () => {
      if (codeResult instanceof Error) throw codeResult;
      return codeResult;
    },
    close: vi.fn(),
  });
}

function baseDeps(over: Partial<Parameters<typeof addAccount>[1]> = {}) {
  return {
    post: vi.fn().mockResolvedValue({
      status: 200, json: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
    }),
    secrets: { getSecret: vi.fn().mockResolvedValue(null), setSecret: vi.fn().mockResolvedValue(undefined) },
    openBrowser: vi.fn(),
    now: () => 0,
    fetchProfileEmail: vi.fn().mockResolvedValue("me@example.com"),
    genId: () => "acct-1",
    ...over,
  };
}

describe("addAccount", () => {
  it("completes the flow and returns an AccountConfig", async () => {
    const capturedState = { value: "" };
    const deps = baseDeps({
      openBrowser: vi.fn((url: string) => { capturedState.value = new URL(url).searchParams.get("state")!; }),
    });
    // The loopback must echo back the same state the authorize URL used.
    const factory = () => ({
      listen: async () => ({ port: 1, redirectUri: "http://localhost:1" }),
      waitForCode: async () => ({ code: "CODE", state: capturedState.value }),
      close: vi.fn(),
    });
    const { account } = await addAccount(
      { kind: "ms-graph", clientId: "cid" },
      { ...deps, makeLoopback: factory },
    );
    expect(account).toMatchObject({ id: "acct-1", email: "me@example.com", provider: "ms-graph", clientId: "cid" });
    expect(deps.openBrowser).toHaveBeenCalledOnce();
    const [, form] = (deps.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(form.code).toBe("CODE");
    expect(form.client_secret).toBeUndefined();
  });

  it("stores only the refresh token via TokenManager", async () => {
    const capturedState = { value: "" };
    const deps = baseDeps({
      openBrowser: (url: string) => { capturedState.value = new URL(url).searchParams.get("state")!; },
    });
    const factory = () => ({
      listen: async () => ({ port: 1, redirectUri: "http://localhost:1" }),
      waitForCode: async () => ({ code: "C", state: capturedState.value }),
      close: vi.fn(),
    });
    await addAccount({ kind: "ms-graph", clientId: "cid" }, { ...deps, makeLoopback: factory });
    expect(deps.secrets.setSecret).toHaveBeenCalledWith("obsidian-email-acct-1-refresh", "rt");
    expect(deps.secrets.setSecret).toHaveBeenCalledOnce();
  });

  it("throws AuthError on a state mismatch and closes the loopback", async () => {
    const close = vi.fn();
    const factory = () => ({
      listen: async () => ({ port: 1, redirectUri: "http://localhost:1" }),
      waitForCode: async () => ({ code: "C", state: "WRONG" }),
      close,
    });
    await expect(
      addAccount({ kind: "ms-graph", clientId: "cid" }, { ...baseDeps(), makeLoopback: factory }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(close).toHaveBeenCalled();
  });

  it("builds a Microsoft authorize URL with the localhost redirect", async () => {
    const url = buildAuthorizeUrl(OAUTH_CONFIG["ms-graph"], {
      clientId: "c", redirectUri: "http://localhost:9", challenge: "x", state: "s",
    });
    expect(url).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A9");
    expect(url).toContain("offline_access");
  });
});
