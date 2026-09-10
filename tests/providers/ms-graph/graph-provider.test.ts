import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GraphProvider } from "../../../src/providers/ms-graph/graph-provider";
import { runMailProviderContract } from "../../../src/providers/provider-contract";
import type { HttpClient, HttpResponse } from "../../../src/providers/http";

const fx = (p: string) => JSON.parse(readFileSync(`tests/fixtures/graph/${p}`, "utf8"));
const resp = (json: unknown, status = 200, headers: Record<string, string> = {}): HttpResponse =>
  ({ status, json, text: JSON.stringify(json), arrayBuffer: new ArrayBuffer(0), headers });

describe("GraphProvider", () => {
  it("listMessages maps items and returns the nextLink as the page token", async () => {
    const http: HttpClient = { request: vi.fn(async () => resp(fx("messages-page.json"))) };
    const p = new GraphProvider({ http, getAccessToken: async () => "at" });
    const page = await p.listMessages("AAAInbox");
    expect(page.items.map((m) => m.id)).toEqual(["G1", "G2"]);
    expect(page.nextPageToken).toContain("$skiptoken=PAGE2");
  });

  it("follows a page token URL verbatim", async () => {
    const req = vi.fn(async () => resp({ value: [] }));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.listMessages("AAAInbox", "https://graph.microsoft.com/v1.0/x?$skiptoken=Z");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/x?$skiptoken=Z");
  });

  it("syncSince collects upserts and @removed deletions and stores the new deltaLink", async () => {
    const http: HttpClient = { request: vi.fn(async () => resp(fx("delta-page.json"))) };
    const p = new GraphProvider({ http, getAccessToken: async () => "at" });
    const result = await p.syncSince({
      kind: "ms-graph",
      deltaLinks: { AAAInbox: "https://graph.microsoft.com/v1.0/me/mailFolders/AAAInbox/messages/delta?$deltatoken=OLD" },
    });
    expect(result.upserts.map((m) => m.id)).toEqual(["G3"]);
    expect(result.deletions).toEqual(["G1"]);
    expect(result.cursor).toMatchObject({
      kind: "ms-graph",
      deltaLinks: { AAAInbox: expect.stringContaining("$deltatoken=NEXT") },
    });
  });

  it("throws AuthError on 401", async () => {
    const http: HttpClient = { request: vi.fn(async () => resp({}, 401)) };
    const p = new GraphProvider({ http, getAccessToken: async () => "at" });
    await expect(p.listMailboxes()).rejects.toMatchObject({ name: "AuthError" });
  });

  const staleCursor = {
    kind: "ms-graph" as const,
    deltaLinks: { AAAInbox: "https://graph.microsoft.com/v1.0/me/mailFolders/AAAInbox/messages/delta?$deltatoken=OLD" },
  };

  it("throws CursorExpiredError on a 410 Gone delta token", async () => {
    const http: HttpClient = {
      request: vi.fn(async () => resp({ error: { code: "resyncRequired" } }, 410)),
    };
    const p = new GraphProvider({ http, getAccessToken: async () => "at" });
    await expect(p.syncSince(staleCursor)).rejects.toMatchObject({ name: "CursorExpiredError" });
  });

  it("throws CursorExpiredError on a resyncRequired body without a 410", async () => {
    const http: HttpClient = {
      request: vi.fn(async () => resp({ error: { code: "resyncRequired" } }, 400)),
    };
    const p = new GraphProvider({ http, getAccessToken: async () => "at" });
    await expect(p.syncSince(staleCursor)).rejects.toMatchObject({ name: "CursorExpiredError" });
  });

  it("leaves an unrelated 400 as a plain ProviderError", async () => {
    const http: HttpClient = { request: vi.fn(async () => resp({ error: { code: "badRequest" } }, 400)) };
    const p = new GraphProvider({ http, getAccessToken: async () => "at" });
    await expect(p.syncSince(staleCursor)).rejects.toMatchObject({ name: "ProviderError", status: 400 });
  });
});

runMailProviderContract("GraphProvider", async () => {
  const msgs = new Map<string, Record<string, unknown>>();
  const deltaLog: Array<{ seq: number; id: string; removed?: boolean }> = [];
  let seq = 0;
  const seedInbox = async (n: number) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = `X${msgs.size + 1}`;
      seq++;
      msgs.set(id, { id, conversationId: id, subject: id, receivedDateTime: new Date(seq * 1000).toISOString(), isRead: false });
      deltaLog.push({ seq, id });
      ids.push(id);
    }
    return ids;
  };
  const http: HttpClient = {
    request: vi.fn(async ({ url }) => {
      if (/\/mailFolders(\?|$)/.test(url) || /\/mailFolders$/.test(url)) {
        return resp({ value: [{ id: "AAAInbox", displayName: "Inbox", wellKnownName: "inbox" }] });
      }
      if (/messages\/delta/.test(url)) {
        const since = Number(new URL(url).searchParams.get("$deltatoken") ?? 0);
        const value = deltaLog.filter((e) => e.seq > since).map((e) =>
          e.removed ? { id: e.id, "@removed": { reason: "deleted" } } : msgs.get(e.id),
        );
        return resp({ value, "@odata.deltaLink": `https://g/me/mailFolders/AAAInbox/messages/delta?$deltatoken=${seq}` });
      }
      // list messages
      const all = [...msgs.values()];
      const u = new URL(url);
      const skip = Number(u.searchParams.get("$skiptoken") ?? 0);
      const slice = all.slice(skip, skip + 2);
      const body: Record<string, unknown> = { value: slice };
      if (skip + 2 < all.length) body["@odata.nextLink"] = `https://g/me/mailFolders/AAAInbox/messages?$skiptoken=${skip + 2}`;
      return resp(body);
    }),
  };
  const provider = new GraphProvider({ http, getAccessToken: async () => "at", syncFolderIds: ["AAAInbox"] });
  return { provider, seedInbox };
});
