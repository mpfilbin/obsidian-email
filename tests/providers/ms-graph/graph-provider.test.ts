import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GraphProvider } from "../../../src/providers/ms-graph/graph-provider";
import { runMailProviderContract } from "../../../src/providers/provider-contract";
import type { HttpClient, HttpResponse } from "../../../src/providers/http";
import { AuthError, ContactsConsentRequired } from "../../../src/providers/types";

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

  it("selects bccRecipients so an edited draft can round-trip its Bcc", async () => {
    const req = vi.fn(async () => resp({ value: [] }));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.listMessages("AAADrafts");
    expect(req.mock.calls[0][0].url).toContain("bccRecipients");
  });

  it("follows a page token URL verbatim", async () => {
    const req = vi.fn(async () => resp({ value: [] }));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.listMessages("AAAInbox", "https://graph.microsoft.com/v1.0/x?$skiptoken=Z");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/x?$skiptoken=Z");
  });

  it("createMailbox POSTs /me/mailFolders and maps the created folder as a custom mailbox", async () => {
    const req = vi.fn(async () => resp({ id: "AAANewFolder", displayName: "Project X" }));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    const box = await p.createMailbox("Project X");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/mailFolders");
    expect(req.mock.calls[0][0].method).toBe("POST");
    expect(JSON.parse(req.mock.calls[0][0].body)).toEqual({ displayName: "Project X" });
    expect(box).toEqual({ id: "AAANewFolder", name: "Project X", kind: "custom" });
  });

  it("renameMailbox PATCHes /me/mailFolders/{id} with the new displayName", async () => {
    const req = vi.fn(async () => resp({ id: "AAAFolder", displayName: "Renamed" }));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    const box = await p.renameMailbox("AAAFolder", "Renamed");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/mailFolders/AAAFolder");
    expect(req.mock.calls[0][0].method).toBe("PATCH");
    expect(JSON.parse(req.mock.calls[0][0].body)).toEqual({ displayName: "Renamed" });
    expect(box).toEqual({ id: "AAAFolder", name: "Renamed", kind: "custom" });
  });

  it("deleteMailbox DELETEs /me/mailFolders/{id}", async () => {
    const req = vi.fn(async () => resp({}, 204));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.deleteMailbox("AAAFolder");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/mailFolders/AAAFolder");
    expect(req.mock.calls[0][0].method).toBe("DELETE");
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

  it("includes Graph's error.message in a rejected request's message, not just the bare status", async () => {
    const http: HttpClient = {
      request: vi.fn(async () => resp(
        { error: { code: "ErrorInvalidRequest", message: "Distinguished folders cannot be deleted." } },
        400,
      )),
    };
    const p = new GraphProvider({ http, getAccessToken: async () => "at" });
    await expect(p.deleteMailbox("AAAFolder")).rejects.toMatchObject({
      name: "ProviderError",
      status: 400,
      code: "ErrorInvalidRequest",
      message: "Graph 400: Distinguished folders cannot be deleted.",
    });
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

describe("GraphProvider — send/draft", () => {
  it("sendNewMessage POSTs to /sendMail with the full message shape", async () => {
    const req = vi.fn(async () => resp({}, 202));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.sendNewMessage({
      to: [{ email: "a@x.com" }], cc: [{ name: "B", email: "b@x.com" }], bcc: [],
      subject: "Hi", bodyHtml: "<p>hi</p>",
    });
    const call = req.mock.calls[0][0];
    expect(call.url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(call.method).toBe("POST");
    expect(call.headers.Authorization).toBe("Bearer at");
    expect(JSON.parse(call.body)).toEqual({
      message: {
        subject: "Hi",
        body: { contentType: "HTML", content: "<p>hi</p>" },
        toRecipients: [{ emailAddress: { address: "a@x.com" } }],
        ccRecipients: [{ emailAddress: { address: "b@x.com", name: "B" } }],
        bccRecipients: [],
      },
    });
  });

  it("replyToMessage POSTs to /reply for mode=reply", async () => {
    const req = vi.fn(async () => resp({}, 202));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.replyToMessage("m1", "reply", "<p>thanks</p>");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/m1/reply");
    expect(JSON.parse(req.mock.calls[0][0].body)).toEqual({ comment: "<p>thanks</p>" });
  });

  it("replyToMessage POSTs to /replyAll for mode=replyAll", async () => {
    const req = vi.fn(async () => resp({}, 202));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.replyToMessage("m1", "replyAll", "<p>thanks</p>");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/m1/replyAll");
  });

  it("forwardMessage POSTs to /forward with comment and recipients", async () => {
    const req = vi.fn(async () => resp({}, 202));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.forwardMessage("m1", "<p>fyi</p>", [{ email: "c@x.com" }]);
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/m1/forward");
    expect(JSON.parse(req.mock.calls[0][0].body)).toEqual({
      comment: "<p>fyi</p>",
      toRecipients: [{ emailAddress: { address: "c@x.com" } }],
    });
  });

  it("createDraft POSTs to /me/messages and returns the new id", async () => {
    const req = vi.fn(async () => resp({ id: "draft-1" }, 201));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    const id = await p.createDraft({ to: [{ email: "a@x.com" }], cc: [], bcc: [], subject: "S", bodyHtml: "<p>b</p>" });
    expect(id).toBe("draft-1");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages");
    expect(req.mock.calls[0][0].method).toBe("POST");
  });

  it("updateDraft PATCHes /me/messages/{id}", async () => {
    const req = vi.fn(async () => resp({}, 200));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.updateDraft("draft-1", { to: [], cc: [], bcc: [], subject: "S2", bodyHtml: "<p>b2</p>" });
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/draft-1");
    expect(req.mock.calls[0][0].method).toBe("PATCH");
  });

  it("sendNewMessage includes a fileAttachment when the message has one staged", async () => {
    const req = vi.fn(async () => resp({}, 202));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.sendNewMessage({
      to: [], cc: [], bcc: [], subject: "S", bodyHtml: "<p>b</p>",
      attachments: [{ filename: "note.md", mimeType: "text/markdown", contentBytes: "aGk=" }],
    });
    const body = JSON.parse(req.mock.calls[0][0].body);
    expect(body.message.attachments).toEqual([{
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "note.md", contentType: "text/markdown", contentBytes: "aGk=",
    }]);
  });

  it("createDraft includes a fileAttachment when the message has one staged", async () => {
    const req = vi.fn(async () => resp({ id: "draft-1" }, 201));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.createDraft({
      to: [], cc: [], bcc: [], subject: "S", bodyHtml: "<p>b</p>",
      attachments: [{ filename: "note.md", mimeType: "text/markdown", contentBytes: "aGk=" }],
    });
    const body = JSON.parse(req.mock.calls[0][0].body);
    expect(body.attachments).toEqual([{
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "note.md", contentType: "text/markdown", contentBytes: "aGk=",
    }]);
  });

  it("updateDraft never sends attachments, even when the message carries them", async () => {
    const req = vi.fn(async () => resp({}, 200));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.updateDraft("draft-1", {
      to: [], cc: [], bcc: [], subject: "S2", bodyHtml: "<p>b2</p>",
      attachments: [{ filename: "note.md", mimeType: "text/markdown", contentBytes: "aGk=" }],
    });
    const body = JSON.parse(req.mock.calls[0][0].body);
    expect(body.attachments).toBeUndefined();
  });

  it("sendDraft POSTs /me/messages/{id}/send", async () => {
    const req = vi.fn(async () => resp({}, 202));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.sendDraft("draft-1");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/draft-1/send");
    expect(req.mock.calls[0][0].method).toBe("POST");
  });

  it("deleteDraft DELETEs /me/messages/{id}", async () => {
    const req = vi.fn(async () => resp({}, 204));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.deleteDraft("draft-1");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/draft-1");
    expect(req.mock.calls[0][0].method).toBe("DELETE");
  });

  it("retries a send once on 429 then succeeds", async () => {
    let calls = 0;
    const req = vi.fn(async () => (++calls === 1 ? resp({}, 429, { "retry-after": "0" }) : resp({}, 202)));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.sendNewMessage({ to: [], cc: [], bcc: [], subject: "S", bodyHtml: "<p>b</p>" });
    expect(calls).toBe(2);
  });

  it("throws AuthError on 401", async () => {
    const req = vi.fn(async () => resp({}, 401));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await expect(p.sendNewMessage({ to: [], cc: [], bcc: [], subject: "S", bodyHtml: "<p>b</p>" }))
      .rejects.toMatchObject({ name: "AuthError" });
  });
});

describe("GraphProvider — delete/archive", () => {
  it("deleteMessage DELETEs /me/messages/{id}", async () => {
    const req = vi.fn(async () => resp({}, 204));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.deleteMessage("m1");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/m1");
    expect(req.mock.calls[0][0].method).toBe("DELETE");
  });

  it("archiveMessage POSTs /me/messages/{id}/move with destinationId: archive", async () => {
    const req = vi.fn(async () => resp({}, 200));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.archiveMessage("m1");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/m1/move");
    expect(req.mock.calls[0][0].method).toBe("POST");
    expect(JSON.parse(req.mock.calls[0][0].body)).toEqual({ destinationId: "archive" });
  });

  it("moveMessage POSTs /me/messages/{id}/move with the given destinationId", async () => {
    const req = vi.fn(async () => resp({}, 200));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.moveMessage("m1", "AAMkCustomFolder");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/m1/move");
    expect(req.mock.calls[0][0].method).toBe("POST");
    expect(JSON.parse(req.mock.calls[0][0].body)).toEqual({ destinationId: "AAMkCustomFolder" });
  });

  it("deleteDraft still DELETEs /me/messages/{id} after the refactor", async () => {
    const req = vi.fn(async () => resp({}, 204));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.deleteDraft("draft-1");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/draft-1");
    expect(req.mock.calls[0][0].method).toBe("DELETE");
  });

  it("deleteMessage throws AuthError on 401", async () => {
    const req = vi.fn(async () => resp({}, 401));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await expect(p.deleteMessage("m1")).rejects.toMatchObject({ name: "AuthError" });
  });

  it("archiveMessage retries once on 429 then succeeds", async () => {
    let calls = 0;
    const req = vi.fn(async () => (++calls === 1 ? resp({}, 429, { "retry-after": "0" }) : resp({}, 200)));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.archiveMessage("m1");
    expect(calls).toBe(2);
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

describe("GraphProvider contacts", () => {
  const make = (req: ReturnType<typeof vi.fn>) =>
    new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });

  it("listContacts pages through @odata.nextLink and maps each contact", async () => {
    const req = vi.fn()
      .mockResolvedValueOnce(resp({ value: [{ id: "C1", displayName: "Ada" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/contacts?$skiptoken=P2" }))
      .mockResolvedValueOnce(resp({ value: [{ id: "C2", displayName: "Bob" }] }));
    const contacts = await make(req).listContacts();
    expect(contacts.map((c) => c.id)).toEqual(["C1", "C2"]);
    expect(req.mock.calls[0][0].url).toContain("/me/contacts?$select=");
    expect(req.mock.calls[1][0].url).toBe("https://graph.microsoft.com/v1.0/me/contacts?$skiptoken=P2");
  });

  it("a 403 on a contacts call becomes ContactsConsentRequired, not AuthError", async () => {
    const req = vi.fn(async () => resp({ error: { code: "ErrorAccessDenied" } }, 403));
    await expect(make(req).listContacts()).rejects.toBeInstanceOf(ContactsConsentRequired);
  });

  it("a 401 on a contacts call is still an AuthError", async () => {
    const req = vi.fn(async () => resp({}, 401));
    await expect(make(req).listContacts()).rejects.toBeInstanceOf(AuthError);
  });

  it("a 403 on a MAIL call is still an AuthError", async () => {
    const req = vi.fn(async () => resp({}, 403));
    await expect(make(req).listMailboxes()).rejects.toBeInstanceOf(AuthError);
  });

  it("createContact POSTs /me/contacts with the mapped body and returns the created contact", async () => {
    const req = vi.fn(async () => resp({ id: "C9", displayName: "Ada", emailAddresses: [{ address: "ada@x.com", name: "ada@x.com" }] }, 201));
    const created = await make(req).createContact({
      displayName: "Ada", emails: [{ email: "ada@x.com" }], businessPhones: [], homePhones: [],
    });
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/contacts");
    expect(req.mock.calls[0][0].method).toBe("POST");
    expect(JSON.parse(req.mock.calls[0][0].body)).toMatchObject({
      displayName: "Ada", emailAddresses: [{ address: "ada@x.com", name: "ada@x.com" }],
    });
    expect(created).toMatchObject({ id: "C9", emails: [{ email: "ada@x.com" }] });
  });

  it("updateContact PATCHes only the patched fields", async () => {
    const req = vi.fn(async () => resp({ id: "C1", displayName: "Ada", jobTitle: "CTO" }));
    const updated = await make(req).updateContact("C1", { jobTitle: "CTO" });
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/contacts/C1");
    expect(req.mock.calls[0][0].method).toBe("PATCH");
    expect(JSON.parse(req.mock.calls[0][0].body)).toEqual({ jobTitle: "CTO" });
    expect(updated.jobTitle).toBe("CTO");
  });

  it("deleteContact DELETEs, and treats 404 as success", async () => {
    const req = vi.fn(async () => resp({}, 204));
    await make(req).deleteContact("C1");
    expect(req.mock.calls[0][0].method).toBe("DELETE");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/contacts/C1");
    const gone = vi.fn(async () => resp({ error: { code: "ErrorItemNotFound", message: "gone" } }, 404));
    await expect(make(gone).deleteContact("C1")).resolves.toBeUndefined();
  });
});
