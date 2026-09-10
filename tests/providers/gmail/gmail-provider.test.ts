import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GmailProvider } from "../../../src/providers/gmail/gmail-provider";
import { runMailProviderContract } from "../../../src/providers/provider-contract";
import type { HttpClient, HttpResponse } from "../../../src/providers/http";

const fx = (p: string) => JSON.parse(readFileSync(`tests/fixtures/gmail/${p}`, "utf8"));

function resp(json: unknown, status = 200, headers: Record<string, string> = {}): HttpResponse {
  return { status, json, text: JSON.stringify(json), arrayBuffer: new ArrayBuffer(0), headers };
}

/** Route requests by URL substring. */
function router(routes: Array<[RegExp, (url: string) => HttpResponse]>): HttpClient {
  return {
    request: vi.fn(async ({ url }) => {
      for (const [re, fn] of routes) if (re.test(url)) return fn(url);
      throw new Error(`no route for ${url}`);
    }),
  };
}

describe("GmailProvider", () => {
  it("listMessages hydrates summaries and passes through the page token", async () => {
    const http = router([
      [/messages\?/, () => resp(fx("messages-list.json"))],
      [/messages\/m1/, () => resp({ ...fx("message-metadata.json"), id: "m1", threadId: "t1" })],
      [/messages\/m2/, () => resp({ ...fx("message-metadata.json"), id: "m2", threadId: "t2" })],
    ]);
    const p = new GmailProvider({ http, getAccessToken: async () => "at" });
    const page = await p.listMessages("INBOX");
    expect(page.items.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
    expect(page.nextPageToken).toBe("PAGE2");
  });

  it("sends the bearer token", async () => {
    const http = router([[/./, () => resp(fx("profile.json"))]]);
    const p = new GmailProvider({ http, getAccessToken: async () => "tok123" });
    await p.initialCursor();
    const call = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.headers.Authorization).toBe("Bearer tok123");
  });

  it("syncSince returns upserts and deletions from history", async () => {
    const http = router([
      [/history\?/, () => resp(fx("history.json"))],
      [/messages\/m3/, () => resp({ ...fx("message-metadata.json"), id: "m3", threadId: "t3" })],
    ]);
    const p = new GmailProvider({ http, getAccessToken: async () => "at" });
    const result = await p.syncSince({ kind: "gmail", historyId: "900" });
    expect(result.upserts.map((m) => m.id)).toContain("m3");
    expect(result.deletions).toContain("m1");
    expect(result.cursor).toEqual({ kind: "gmail", historyId: "902" });
  });

  it("retries once on HTTP 429 then succeeds", async () => {
    let calls = 0;
    const http: HttpClient = {
      request: vi.fn(async () => {
        calls++;
        return calls === 1 ? resp({}, 429, { "retry-after": "0" }) : resp(fx("profile.json"));
      }),
    };
    const p = new GmailProvider({ http, getAccessToken: async () => "at" });
    await expect(p.initialCursor()).resolves.toEqual({ kind: "gmail", historyId: "900" });
    expect(calls).toBe(2);
  });

  it("throws AuthError on 401", async () => {
    const http = router([[/./, () => resp({ error: "unauthorized" }, 401)]]);
    const p = new GmailProvider({ http, getAccessToken: async () => "at" });
    await expect(p.listMailboxes()).rejects.toMatchObject({ name: "AuthError" });
  });
});

runMailProviderContract("GmailProvider", async () => {
  const state = {
    messages: new Map<string, Record<string, unknown>>(),
    history: [] as Array<Record<string, unknown>>,
    historyId: 100,
  };
  const seedInbox = async (n: number) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = `g${state.messages.size + 1}`;
      state.historyId++;
      state.messages.set(id, {
        id, threadId: id, labelIds: ["INBOX", "UNREAD"], snippet: "",
        payload: { headers: [
          { name: "From", value: "s@x.com" }, { name: "Subject", value: id },
          { name: "Date", value: new Date(state.historyId * 1000).toUTCString() },
        ] },
      });
      state.history.push({ id: String(state.historyId), messagesAdded: [{ message: { id, threadId: id, labelIds: ["INBOX"] } }] });
      ids.push(id);
    }
    return ids;
  };
  const http: HttpClient = {
    request: vi.fn(async ({ url }) => {
      if (/\/profile/.test(url)) return resp({ emailAddress: "me@x.com", historyId: String(state.historyId) });
      if (/history\?/.test(url)) {
        const since = Number(new URL(url).searchParams.get("startHistoryId"));
        return resp({ history: state.history.filter((h) => Number(h.id) > since), historyId: String(state.historyId) });
      }
      const idMatch = url.match(/messages\/([^/?]+)/);
      if (idMatch) return resp(state.messages.get(idMatch[1]) ?? {});
      // messages?labelIds=...
      const all = [...state.messages.keys()].map((id) => ({ id, threadId: id }));
      const u = new URL(url);
      const start = Number(u.searchParams.get("pageToken") ?? 0);
      const size = 2;
      const slice = all.slice(start, start + size);
      const next = start + size < all.length ? String(start + size) : undefined;
      return resp({ messages: slice, nextPageToken: next });
    }),
  };
  const provider = new GmailProvider({ http, getAccessToken: async () => "at", concurrency: 2 });
  return { provider, seedInbox };
});
