import { describe, it, expect, vi } from "vitest";
import { createProvider } from "../../src/providers/provider-factory";
import { makeObsidianHttp } from "../../src/providers/obsidian-http";
import { GmailProvider } from "../../src/providers/gmail/gmail-provider";
import { GraphProvider } from "../../src/providers/ms-graph/graph-provider";
import type { TokenManager } from "../../src/auth/token-manager";

const fakeToken = { getAccessToken: async () => "at" } as unknown as TokenManager;
const fakeHttp = { request: vi.fn() };

describe("createProvider", () => {
  it("returns a GmailProvider for gmail accounts", () => {
    const p = createProvider(
      { id: "1", email: "a@g.com", provider: "gmail", clientId: "c", addedAt: 0 },
      fakeToken, fakeHttp,
    );
    expect(p).toBeInstanceOf(GmailProvider);
    expect(p.kind).toBe("gmail");
  });

  it("returns a GraphProvider for ms-graph accounts", () => {
    const p = createProvider(
      { id: "2", email: "a@o.com", provider: "ms-graph", clientId: "c", addedAt: 0 },
      fakeToken, fakeHttp,
    );
    expect(p).toBeInstanceOf(GraphProvider);
  });
});

describe("makeObsidianHttp", () => {
  it("adapts requestUrl and forces throw:false", async () => {
    const requestUrl = vi.fn().mockResolvedValue({
      status: 200, json: { ok: true }, text: "{}", arrayBuffer: new ArrayBuffer(0), headers: {},
    });
    const http = makeObsidianHttp(requestUrl as never);
    const res = await http.request({ url: "https://x", method: "GET" });
    expect(res.status).toBe(200);
    expect(requestUrl.mock.calls[0][0]).toMatchObject({ url: "https://x", method: "GET", throw: false });
  });
});
