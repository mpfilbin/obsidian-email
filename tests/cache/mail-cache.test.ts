import { describe, it, expect, beforeEach } from "vitest";
import { MailCache } from "../../src/cache/mail-cache";
import type { MessageSummary } from "../../src/providers/types";

let n = 0;
const freshName = () => `test-db-${Date.now()}-${n++}`;

function msg(id: string, over: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id, threadId: over.threadId ?? id, mailboxIds: over.mailboxIds ?? ["INBOX"],
    from: { email: "s@x.com" }, to: [], cc: [],
    subject: `s ${id}`, snippet: "", date: over.date ?? 1000,
    unread: true, hasAttachments: false, flagged: false, ...over,
  };
}

describe("MailCache", () => {
  let cache: MailCache;
  beforeEach(async () => { cache = await MailCache.open(freshName()); });

  it("upserts and lists mailbox messages newest-first", async () => {
    await cache.upsertMessages("a1", [msg("m1", { date: 1 }), msg("m2", { date: 3 }), msg("m3", { date: 2 })]);
    const list = await cache.listMailboxMessages("a1", "INBOX");
    expect(list.map((m) => m.id)).toEqual(["m2", "m3", "m1"]);
  });

  it("filters by mailbox membership", async () => {
    await cache.upsertMessages("a1", [msg("m1", { mailboxIds: ["INBOX"] }), msg("m2", { mailboxIds: ["SENT"] })]);
    expect((await cache.listMailboxMessages("a1", "SENT")).map((m) => m.id)).toEqual(["m2"]);
  });

  it("isolates accounts", async () => {
    await cache.upsertMessages("a1", [msg("m1")]);
    await cache.upsertMessages("a2", [msg("m1")]);
    await cache.deleteMessages("a1", ["m1"]);
    expect(await cache.listMailboxMessages("a1", "INBOX")).toHaveLength(0);
    expect(await cache.listMailboxMessages("a2", "INBOX")).toHaveLength(1);
  });

  it("stores and returns thread messages", async () => {
    await cache.upsertMessages("a1", [msg("m1", { threadId: "t" }), msg("m2", { threadId: "t" }), msg("m3", { threadId: "u" })]);
    expect((await cache.getThreadMessages("a1", "t")).map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });

  it("stores and evicts bodies by LRU count", async () => {
    for (let i = 0; i < 205; i++) {
      await cache.putBody("a1", { id: `b${i}`, html: null, text: "x", attachments: [], headers: {} });
    }
    await cache.pruneAccount("a1", Date.now());
    expect(await cache.getBody("a1", "b0")).toBeUndefined();
    expect(await cache.getBody("a1", "b204")).toBeTruthy();
  });

  it("prunes summaries older than the retention window when over the per-mailbox cap", async () => {
    const now = Date.now();
    const old = now - 100 * 24 * 3600 * 1000;
    const many = Array.from({ length: 2001 }, (_, i) => msg(`m${i}`, { date: i < 5 ? old : now }));
    await cache.upsertMessages("a1", many);
    await cache.pruneAccount("a1", now);
    const list = await cache.listMailboxMessages("a1", "INBOX", { limit: 5000 });
    expect(list.find((m) => m.id === "m0")).toBeUndefined();
    expect(list.length).toBe(1996);
  });

  it("patchMessages merges onto an existing record, preserving fields the patch omits", async () => {
    await cache.upsertMessages("a1", [msg("m1", { subject: "Real subject", from: { name: "Jane", email: "j@x.com" } })]);
    // Simulates a Graph delta item that only reported a read-status change.
    await cache.patchMessages("a1", [{ id: "m1", mailboxIds: ["INBOX"], unread: false }]);
    const [stored] = await cache.listMailboxMessages("a1", "INBOX");
    expect(stored.subject).toBe("Real subject");
    expect(stored.from).toEqual({ name: "Jane", email: "j@x.com" });
    expect(stored.unread).toBe(false);
  });

  it("patchMessages falls back to placeholder defaults for a message never seen before", async () => {
    await cache.patchMessages("a1", [{ id: "m1", mailboxIds: ["INBOX"], unread: false }]);
    const [stored] = await cache.listMailboxMessages("a1", "INBOX");
    expect(stored.subject).toBe("(no subject)");
    expect(stored.from).toEqual({ email: "" });
  });

  it("replaceMailboxes upserts the given folders and removes cached ones no longer present", async () => {
    await cache.putMailboxes("a1", [
      { id: "INBOX", name: "Inbox", kind: "inbox" },
      { id: "CUSTOM1", name: "Old Project", kind: "custom" },
    ]);
    const removed = await cache.replaceMailboxes("a1", [
      { id: "INBOX", name: "Inbox", kind: "inbox", unreadCount: 3 },
      { id: "CUSTOM2", name: "New Project", kind: "custom" },
    ]);
    expect(removed).toEqual(["CUSTOM1"]);
    const boxes = await cache.getMailboxes("a1");
    expect(boxes.map((b) => b.id).sort()).toEqual(["CUSTOM2", "INBOX"]);
    expect(boxes.find((b) => b.id === "INBOX")?.unreadCount).toBe(3);
  });

  it("replaceMailboxes leaves another account's cached folders untouched", async () => {
    await cache.putMailboxes("a1", [{ id: "CUSTOM1", name: "Mine", kind: "custom" }]);
    await cache.putMailboxes("a2", [{ id: "CUSTOM1", name: "Theirs", kind: "custom" }]);
    await cache.replaceMailboxes("a1", []);
    expect(await cache.getMailboxes("a1")).toHaveLength(0);
    expect(await cache.getMailboxes("a2")).toHaveLength(1);
  });

  it("deleteMailboxes removes only the given ids, leaving the rest and other accounts untouched", async () => {
    await cache.putMailboxes("a1", [
      { id: "INBOX", name: "Inbox", kind: "inbox" },
      { id: "CUSTOM1", name: "Project X", kind: "custom" },
    ]);
    await cache.putMailboxes("a2", [{ id: "CUSTOM1", name: "Theirs", kind: "custom" }]);
    await cache.deleteMailboxes("a1", ["CUSTOM1"]);
    expect((await cache.getMailboxes("a1")).map((b) => b.id)).toEqual(["INBOX"]);
    expect(await cache.getMailboxes("a2")).toHaveLength(1);
  });

  it("deleteMessagesByMailbox removes only messages in the given mailboxes", async () => {
    await cache.upsertMessages("a1", [
      msg("m1", { mailboxIds: ["CUSTOM1"] }),
      msg("m2", { mailboxIds: ["INBOX"] }),
    ]);
    await cache.deleteMessagesByMailbox("a1", ["CUSTOM1"]);
    expect(await cache.listMailboxMessages("a1", "CUSTOM1")).toHaveLength(0);
    expect(await cache.listMailboxMessages("a1", "INBOX")).toHaveLength(1);
  });

  it("deleteMessagesByMailbox keeps a message that still belongs to a mailbox that wasn't removed", async () => {
    await cache.upsertMessages("a1", [msg("m1", { mailboxIds: ["CUSTOM1", "INBOX"] })]);
    await cache.deleteMessagesByMailbox("a1", ["CUSTOM1"]);
    const [stored] = await cache.listMailboxMessages("a1", "INBOX");
    expect(stored?.id).toBe("m1");
    expect(stored?.mailboxIds).toEqual(["INBOX"]);
  });

  it("clearAccount removes messages, bodies and mailboxes for that account only", async () => {
    await cache.upsertMessages("a1", [msg("m1")]);
    await cache.putMailboxes("a1", [{ id: "INBOX", name: "Inbox", kind: "inbox" }]);
    await cache.upsertMessages("a2", [msg("m9")]);
    await cache.clearAccount("a1");
    expect(await cache.getMailboxes("a1")).toHaveLength(0);
    expect(await cache.listMailboxMessages("a2", "INBOX")).toHaveLength(1);
  });
});
