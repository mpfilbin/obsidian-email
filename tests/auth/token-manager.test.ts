import { describe, it, expect, vi } from "vitest";
import { TokenManager } from "../../src/auth/token-manager";
import { AuthError } from "../../src/providers/types";

function makeSecrets(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getSecret: vi.fn(async (id: string) => map.get(id) ?? null),
    setSecret: vi.fn(async (id: string, s: string) => void map.set(id, s)),
  };
}

const KEY = (id: string, s: string) => `obsidian-email-${id}-${s}`;

describe("TokenManager", () => {
  it("returns the cached access token until near expiry", async () => {
    const secrets = makeSecrets({ [KEY("a1", "refresh")]: "rt" });
    let t = 1_000_000;
    const post = vi.fn().mockResolvedValue({
      status: 200, json: { access_token: "at1", expires_in: 3600 },
    });
    const tm = new TokenManager("a1", "ms-graph", "cid", { secrets, post, now: () => t });
    expect(await tm.getAccessToken()).toBe("at1");
    t += 1000; // 1s later, still valid
    expect(await tm.getAccessToken()).toBe("at1");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("refreshes once when concurrent callers race an expired token", async () => {
    const secrets = makeSecrets({ [KEY("a1", "refresh")]: "rt" });
    const post = vi.fn().mockResolvedValue({
      status: 200, json: { access_token: "atX", expires_in: 3600 },
    });
    const tm = new TokenManager("a1", "ms-graph", "cid", { secrets, post, now: () => 0 });
    const [x, y] = await Promise.all([tm.getAccessToken(), tm.getAccessToken()]);
    expect(x).toBe("atX");
    expect(y).toBe("atX");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("persists a rotated refresh token", async () => {
    const secrets = makeSecrets({ [KEY("a1", "refresh")]: "rt-old" });
    const post = vi.fn().mockResolvedValue({
      status: 200, json: { access_token: "at", refresh_token: "rt-new", expires_in: 3600 },
    });
    const tm = new TokenManager("a1", "ms-graph", "cid", { secrets, post, now: () => 0 });
    await tm.getAccessToken();
    expect(secrets.map.get(KEY("a1", "refresh"))).toBe("rt-new");
  });

  it("throws AuthError when there is no stored refresh token", async () => {
    const secrets = makeSecrets();
    const tm = new TokenManager("a1", "ms-graph", "cid", { secrets, post: vi.fn(), now: () => 0 });
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthError);
  });

  it("throws AuthError when refresh fails and does not cache", async () => {
    const secrets = makeSecrets({ [KEY("a1", "refresh")]: "rt" });
    const post = vi.fn().mockResolvedValue({ status: 400, json: { error: "invalid_grant" } });
    const tm = new TokenManager("a1", "ms-graph", "cid", { secrets, post, now: () => 0 });
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthError);
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthError);
  });

  it("never sends a client secret on refresh", async () => {
    const secrets = makeSecrets({ [KEY("a1", "refresh")]: "rt" });
    const post = vi.fn().mockResolvedValue({
      status: 200, json: { access_token: "at", expires_in: 3600 },
    });
    const tm = new TokenManager("a1", "ms-graph", "cid", { secrets, post, now: () => 0 });
    await tm.getAccessToken();
    const [, form] = post.mock.calls[0];
    expect(form.client_secret).toBeUndefined();
  });
});
