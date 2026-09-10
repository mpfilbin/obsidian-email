import { describe, it, expect } from "vitest";
import http from "node:http";
import { LoopbackServer } from "../../src/auth/loopback-server";
import { AuthError } from "../../src/providers/types";

function hit(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on("error", reject);
  });
}

describe("LoopbackServer", () => {
  it("captures code and state from the redirect", async () => {
    const server = new LoopbackServer("127.0.0.1");
    const { redirectUri } = await server.listen();
    const waiting = server.waitForCode();
    const status = await hit(`${redirectUri}/?code=abc&state=xyz`);
    expect(status).toBe(200);
    await expect(waiting).resolves.toEqual({ code: "abc", state: "xyz" });
    server.close();
  });

  it("rejects with AuthError when the provider returns error", async () => {
    const server = new LoopbackServer("127.0.0.1");
    const { redirectUri } = await server.listen();
    const waiting = server.waitForCode();
    await hit(`${redirectUri}/?error=access_denied`);
    await expect(waiting).rejects.toBeInstanceOf(AuthError);
    server.close();
  });

  it("times out", async () => {
    const server = new LoopbackServer("127.0.0.1");
    await server.listen();
    await expect(server.waitForCode({ timeoutMs: 10 })).rejects.toBeInstanceOf(AuthError);
    server.close();
  });
});
