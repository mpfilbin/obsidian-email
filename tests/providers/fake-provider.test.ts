import { describe, it, expect } from "vitest";
import { FakeProvider } from "../../src/providers/fake-provider";
import { runMailProviderContract } from "../../src/providers/provider-contract";
import { runContactsProviderContract } from "../../src/providers/contacts-contract";
import type { MessageSummary, OutgoingMessage } from "../../src/providers/types";

runMailProviderContract("FakeProvider", async () => {
  const provider = new FakeProvider({
    mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }],
  });
  provider.pageSize = 2;
  let n = 0;
  const seedInbox = async (count: number) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `m${++n}`;
      provider.addMessage({
        id, threadId: id, mailboxIds: ["INBOX"],
        from: { email: "s@x.com" }, to: [], cc: [],
        subject: `msg ${id}`, snippet: "", date: n * 1000,
        unread: true, hasAttachments: false, flagged: false,
      });
      ids.push(id);
    }
    return ids;
  };
  return { provider, seedInbox };
});

runContactsProviderContract("FakeProvider", async () => new FakeProvider());

const msg = (over: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  to: [{ email: "a@x.com" }], cc: [], bcc: [], subject: "Hi", bodyHtml: "<p>hi</p>", ...over,
});

describe("FakeProvider — send/draft behavior", () => {
  it("records sent new messages", async () => {
    const p = new FakeProvider();
    await p.sendNewMessage(msg({ subject: "Test" }));
    expect(p.sentLog).toEqual([{ kind: "new", message: msg({ subject: "Test" }) }]);
  });

  it("records replies with their mode and target id", async () => {
    const p = new FakeProvider();
    await p.replyToMessage("m1", "replyAll", "<p>thanks</p>");
    expect(p.sentLog).toEqual([{ kind: "reply", targetId: "m1", mode: "replyAll", commentHtml: "<p>thanks</p>" }]);
  });

  it("records forwards with recipients", async () => {
    const p = new FakeProvider();
    await p.forwardMessage("m1", "<p>fyi</p>", [{ email: "b@x.com" }]);
    expect(p.sentLog).toEqual([{ kind: "forward", targetId: "m1", commentHtml: "<p>fyi</p>", to: [{ email: "b@x.com" }] }]);
  });

  it("creates, updates, sends, and deletes a draft", async () => {
    const p = new FakeProvider();
    const id = await p.createDraft(msg());
    expect(p.drafts.get(id)).toEqual(msg());

    await p.updateDraft(id, msg({ subject: "Edited" }));
    expect(p.drafts.get(id)).toEqual(msg({ subject: "Edited" }));

    await p.sendDraft(id);
    expect(p.sentLog).toEqual([{ kind: "draft", draftId: id }]);
    expect(p.drafts.has(id)).toBe(false); // sending removes it from the draft map

    const id2 = await p.createDraft(msg());
    await p.deleteDraft(id2);
    expect(p.drafts.has(id2)).toBe(false);
  });

  it("throws on updateDraft/sendDraft/deleteDraft for an unknown id", async () => {
    const p = new FakeProvider();
    await expect(p.updateDraft("nope", msg())).rejects.toThrow();
    await expect(p.sendDraft("nope")).rejects.toThrow();
    await expect(p.deleteDraft("nope")).rejects.toThrow();
  });
});

describe("FakeProvider — delete/archive", () => {
  it("deleteMessage removes the message entirely", async () => {
    const p = new FakeProvider({ messages: [
      { id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { email: "a@x.com" }, to: [], cc: [],
        subject: "s", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: false },
    ] });
    await p.deleteMessage("m1");
    const page = await p.listMessages("INBOX");
    expect(page.items).toEqual([]);
  });

  it("deleteMessage throws for an unknown id", async () => {
    const p = new FakeProvider();
    await expect(p.deleteMessage("nope")).rejects.toThrow();
  });

  it("archiveMessage moves the message to the ARCHIVE mailbox", async () => {
    const p = new FakeProvider({ messages: [
      { id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { email: "a@x.com" }, to: [], cc: [],
        subject: "s", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: false },
    ] });
    await p.archiveMessage("m1");
    expect((await p.listMessages("INBOX")).items).toEqual([]);
    expect((await p.listMessages("ARCHIVE")).items.map((m) => m.id)).toEqual(["m1"]);
  });

  it("archiveMessage throws for an unknown id", async () => {
    const p = new FakeProvider();
    await expect(p.archiveMessage("nope")).rejects.toThrow();
  });

  it("moveMessage moves the message to the given mailbox", async () => {
    const p = new FakeProvider({ messages: [
      { id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { email: "a@x.com" }, to: [], cc: [],
        subject: "s", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: false },
    ] });
    await p.moveMessage("m1", "PROJ");
    expect((await p.listMessages("INBOX")).items).toEqual([]);
    expect((await p.listMessages("PROJ")).items.map((m) => m.id)).toEqual(["m1"]);
  });

  it("moveMessage throws for an unknown id", async () => {
    const p = new FakeProvider();
    await expect(p.moveMessage("nope", "PROJ")).rejects.toThrow();
  });

  it("createMailbox adds a new custom folder with a generated id", async () => {
    const p = new FakeProvider();
    const box = await p.createMailbox("Project X");
    expect(box).toMatchObject({ name: "Project X", kind: "custom" });
    expect(box.id).toBeTruthy();
    expect((await p.listMailboxes()).map((b) => b.id)).toContain(box.id);
  });

  it("renameMailbox updates the folder's name in place", async () => {
    const p = new FakeProvider({ mailboxes: [{ id: "F1", name: "Old", kind: "custom" }] });
    const box = await p.renameMailbox("F1", "New");
    expect(box).toEqual({ id: "F1", name: "New", kind: "custom" });
    expect((await p.listMailboxes()).find((b) => b.id === "F1")?.name).toBe("New");
  });

  it("renameMailbox throws for an unknown id", async () => {
    const p = new FakeProvider();
    await expect(p.renameMailbox("nope", "New")).rejects.toThrow();
  });

  it("deleteMailbox removes the folder from the list", async () => {
    const p = new FakeProvider({ mailboxes: [{ id: "F1", name: "Project X", kind: "custom" }] });
    await p.deleteMailbox("F1");
    expect((await p.listMailboxes()).map((b) => b.id)).not.toContain("F1");
  });

  it("deleteMailbox throws for an unknown id", async () => {
    const p = new FakeProvider();
    await expect(p.deleteMailbox("nope")).rejects.toThrow();
  });

  it("both actions are visible to syncSince (log-backed)", async () => {
    const p = new FakeProvider({ messages: [
      { id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { email: "a@x.com" }, to: [], cc: [],
        subject: "s", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: false },
    ] });
    const cursor = await p.initialCursor();
    await p.archiveMessage("m1");
    const result = await p.syncSince(cursor);
    expect(result.upserts.map((m) => m.mailboxIds)).toEqual([["ARCHIVE"]]);
  });
});

describe("FakeProvider contacts hooks", () => {
  it("seedContacts pre-populates listContacts", async () => {
    const p = new FakeProvider();
    p.seedContacts([{ id: "S1", displayName: "Seed", emails: [], businessPhones: [], homePhones: [] }]);
    expect((await p.listContacts()).map((c) => c.id)).toEqual(["S1"]);
  });

  it("contactsError makes every contacts call reject", async () => {
    const p = new FakeProvider();
    p.contactsError = new Error("nope");
    await expect(p.listContacts()).rejects.toThrow("nope");
    await expect(p.createContact({ displayName: "x", emails: [], businessPhones: [], homePhones: [] })).rejects.toThrow("nope");
  });
});

describe("FakeProvider flags", () => {
  const msg = (id: string, date: number, flagged = false): MessageSummary => ({
    id, threadId: id, mailboxIds: ["INBOX"], from: { email: "s@x.com" }, to: [], cc: [],
    subject: id, snippet: "", date, unread: false, hasAttachments: false, flagged,
  });

  it("setMessageFlag flips the flag and syncSince reports it as an upsert", async () => {
    const p = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    p.addMessage(msg("m1", 1));
    const cursor = await p.initialCursor();
    await p.setMessageFlag("m1", true);
    const result = await p.syncSince(cursor);
    expect(result.upserts.find((u) => u.id === "m1")).toMatchObject({ flagged: true });
    await p.setMessageFlag("m1", false);
    expect((await p.listFlaggedMessages()).items).toEqual([]);
  });

  it("setMessageFlag rejects for an unknown message", async () => {
    await expect(new FakeProvider().setMessageFlag("nope", true)).rejects.toThrow(/no such message/);
  });

  it("listFlaggedMessages returns only flagged messages, newest first, paged", async () => {
    const p = new FakeProvider();
    p.pageSize = 2;
    p.addMessage(msg("a", 1, true));
    p.addMessage(msg("b", 2, false));
    p.addMessage(msg("c", 3, true));
    p.addMessage(msg("d", 4, true));
    const first = await p.listFlaggedMessages();
    expect(first.items.map((m) => m.id)).toEqual(["d", "c"]);
    const second = await p.listFlaggedMessages(first.nextPageToken);
    expect(second.items.map((m) => m.id)).toEqual(["a"]);
    expect(second.nextPageToken).toBeUndefined();
  });
});
