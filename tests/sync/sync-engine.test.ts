import { describe, it, expect, vi } from "vitest";
import { SyncEngine } from "../../src/sync/sync-engine";
import { MailCache } from "../../src/cache/mail-cache";
import { CursorStore } from "../../src/cache/cursor-store";
import { FakeProvider } from "../../src/providers/fake-provider";
import { Logger } from "../../src/util/logger";
import { AuthError } from "../../src/providers/types";
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

  it("sets error status on a transient failure", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    vi.spyOn(provider, "initialCursor").mockRejectedValue(new Error("network"));
    vi.spyOn(provider, "listMessages").mockRejectedValue(new Error("network"));
    vi.spyOn(provider, "listMailboxes").mockRejectedValue(new Error("network"));
    const { engine } = await harness(provider);
    await engine.syncAccount("a1");
    expect(engine.getState("a1").status).toBe("error");
  });
});
