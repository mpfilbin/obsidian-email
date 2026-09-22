import { describe, it, expect, vi } from "vitest";
import { SyncEngine } from "../../src/sync/sync-engine";
import { MailCache } from "../../src/cache/mail-cache";
import { CursorStore } from "../../src/cache/cursor-store";
import { FakeProvider } from "../../src/providers/fake-provider";
import { Logger } from "../../src/util/logger";
import { AuthError, CursorExpiredError } from "../../src/providers/types";
import type { MailProvider, MessageSummary } from "../../src/providers/types";

const logger = new Logger("test", { debug: () => false });
const dbName = () => `sync-db-${Date.now()}-${Math.random()}`;

function summary(id: string, date: number): MessageSummary {
  return {
    id, threadId: id, mailboxIds: ["INBOX"], from: { email: "s@x.com" }, to: [], cc: [],
    subject: id, snippet: "", date, unread: true, hasAttachments: false, flagged: false,
  };
}

async function harness(provider: MailProvider) {
  const name = dbName();
  const cache = await MailCache.open(name);
  const cursors = await CursorStore.open(name);
  const engine = new SyncEngine({
    cache, cursors,
    getProvider: () => provider,
    listAccountIds: () => ["a1"],
    logger,
  });
  return { cache, cursors, engine };
}

describe("SyncEngine", () => {
  it("backfills on first sync then persists a cursor with backfillDone", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    provider.addMessage(summary("m1", 1));
    provider.addMessage(summary("m2", 2));
    const { cache, cursors, engine } = await harness(provider);
    await engine.syncAccount("a1");
    expect((await cache.listMailboxMessages("a1", "INBOX")).map((m) => m.id).sort()).toEqual(["m1", "m2"]);
    expect(await cursors.get("a1")).toMatchObject({ backfillDone: true });
  });

  it("applies incremental upserts and deletions after backfill", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    provider.addMessage(summary("m1", 1));
    const { cache, engine } = await harness(provider);
    await engine.syncAccount("a1");
    provider.addMessage(summary("m2", 2));
    provider.removeMessage("m1");
    await engine.syncAccount("a1");
    expect((await cache.listMailboxMessages("a1", "INBOX")).map((m) => m.id)).toEqual(["m2"]);
  });

  it("picks up a folder created elsewhere during an incremental sync", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    const { cache, engine } = await harness(provider);
    await engine.syncAccount("a1"); // backfill
    provider.addMailbox({ id: "PROJ", name: "Project X", kind: "custom" });
    await engine.syncAccount("a1"); // incremental
    expect((await cache.getMailboxes("a1")).map((b) => b.id).sort()).toEqual(["INBOX", "PROJ"]);
  });

  it("removes a folder deleted elsewhere, along with its cached messages, during an incremental sync", async () => {
    const provider = new FakeProvider({
      mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }, { id: "PROJ", name: "Project X", kind: "custom" }],
    });
    const { cache, engine } = await harness(provider);
    await engine.syncAccount("a1"); // backfill
    // Custom folders aren't backfilled, but a message could still be cached
    // for one from an earlier on-demand load — simulate that directly.
    await cache.upsertMessages("a1", [{
      id: "p1", threadId: "p1", mailboxIds: ["PROJ"], from: { email: "s@x.com" }, to: [], cc: [],
      subject: "s", snippet: "", date: 1, unread: true, hasAttachments: false, flagged: false,
    }]);
    provider.removeMailbox("PROJ");
    await engine.syncAccount("a1"); // incremental
    expect((await cache.getMailboxes("a1")).map((b) => b.id)).toEqual(["INBOX"]);
    expect(await cache.listMailboxMessages("a1", "PROJ")).toHaveLength(0);
  });

  it("emits a CacheChange after a sync", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    provider.addMessage(summary("m1", 1));
    const { engine } = await harness(provider);
    const seen: unknown[] = [];
    engine.changes.on((e) => seen.push(e));
    await engine.syncAccount("a1");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ accountId: "a1", reason: "backfill" });
  });

  it("dedupes concurrent syncAccount calls", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    const spy = vi.spyOn(provider, "listMessages");
    provider.addMessage(summary("m1", 1));
    const { engine } = await harness(provider);
    await Promise.all([engine.syncAccount("a1"), engine.syncAccount("a1")]);
    // one backfill worth of listMessages calls, not two
    const firstRunCalls = spy.mock.calls.length;
    await engine.syncAccount("a1"); // now incremental, no listMessages
    expect(spy.mock.calls.length).toBe(firstRunCalls);
  });

  it("sets needs-reauth on AuthError and does not throw", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    vi.spyOn(provider, "listMailboxes").mockRejectedValue(new AuthError("revoked"));
    vi.spyOn(provider, "listMessages").mockRejectedValue(new AuthError("revoked"));
    vi.spyOn(provider, "initialCursor").mockRejectedValue(new AuthError("revoked"));
    const { engine } = await harness(provider);
    await engine.syncAccount("a1");
    expect(engine.getState("a1").status).toBe("needs-reauth");
  });

  it("recovers from an expired cursor by re-backfilling instead of getting stuck in error", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    provider.addMessage(summary("m1", 1));
    const { cache, cursors, engine } = await harness(provider);
    await engine.syncAccount("a1"); // backfill, cursor stored

    // The provider can no longer diff from the stored cursor (Graph delta
    // 410) — exactly once, as after a resync it can again.
    const sync = vi.spyOn(provider, "syncSince")
      .mockRejectedValueOnce(new CursorExpiredError("history 900 expired"));
    provider.addMessage(summary("m2", 2));

    const changes: unknown[] = [];
    engine.changes.on((e) => changes.push(e));
    await engine.syncAccount("a1");

    expect(engine.getState("a1").status).toBe("idle");
    expect(engine.getState("a1").lastError).toBeUndefined();
    // The backfill re-read the mailbox, so the message added while the cursor
    // was stale is present.
    expect((await cache.listMailboxMessages("a1", "INBOX")).map((m) => m.id).sort()).toEqual(["m1", "m2"]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ accountId: "a1", reason: "backfill" });
    // A usable cursor is stored again, so the next run is incremental.
    expect(await cursors.get("a1")).toMatchObject({ backfillDone: true });
    sync.mockRestore();
    await engine.syncAccount("a1");
    expect(engine.getState("a1").status).toBe("idle");
  });

  it("sets error status on a transient failure", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    vi.spyOn(provider, "initialCursor").mockRejectedValue(new Error("network"));
    vi.spyOn(provider, "listMessages").mockRejectedValue(new Error("network"));
    vi.spyOn(provider, "listMailboxes").mockRejectedValue(new Error("network"));
    const { engine } = await harness(provider);
    await engine.syncAccount("a1");
    expect(engine.getState("a1").status).toBe("error");
  });

  it("passes the pinned thread ids to pruning so pinned threads survive", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    provider.addMessage(summary("m1", 1));
    const name = dbName();
    const cache = await MailCache.open(name);
    const cursors = await CursorStore.open(name);
    const prune = vi.spyOn(cache, "pruneAccount");
    const engine = new SyncEngine({
      cache, cursors, logger,
      getProvider: () => provider,
      listAccountIds: () => ["a1"],
      getPinnedThreadIds: (id) => (id === "a1" ? ["t-pinned"] : []),
    });
    await engine.syncAccount("a1"); // backfill
    await engine.syncAccount("a1"); // incremental
    expect(prune).toHaveBeenCalledTimes(2);
    for (const call of prune.mock.calls) {
      expect(call[0]).toBe("a1");
      expect([...(call[2]?.keepThreadIds ?? [])]).toEqual(["t-pinned"]);
    }
  });
});
