import { describe, it, expect, vi, beforeEach } from "vitest";
import { ViewModel } from "../../src/view/view-model";
import { MailCache } from "../../src/cache/mail-cache";
import { CursorStore } from "../../src/cache/cursor-store";
import { SyncEngine } from "../../src/sync/sync-engine";
import { SettingsStore } from "../../src/settings/settings-store";
import { FakeProvider } from "../../src/providers/fake-provider";
import { Logger } from "../../src/util/logger";
import type { MessageSummary } from "../../src/providers/types";

const logger = new Logger("t", { debug: () => false });
const name = () => `vm-db-${Date.now()}-${Math.random()}`;

function sum(id: string, threadId: string, date: number): MessageSummary {
  return {
    id, threadId, mailboxIds: ["INBOX"], from: { email: "s@x.com" }, to: [], cc: [],
    subject: `s ${threadId}`, snippet: "", date, unread: true, hasAttachments: false, flagged: false,
  };
}

async function build() {
  const dbName = name();
  const cache = await MailCache.open(dbName);
  const cursors = await CursorStore.open(dbName);
  const provider = new FakeProvider({ mailboxes: [
    { id: "INBOX", name: "Inbox", kind: "inbox" },
    { id: "SENT", name: "Sent", kind: "sent" },
  ] });
  const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
  await settings.addAccount({ id: "a1", email: "a1@x.com", provider: "gmail", clientId: "c", addedAt: 0 });
  const sync = new SyncEngine({
    cache, cursors, getProvider: () => provider, listAccountIds: () => ["a1"], logger,
  });
  const vm = new ViewModel({
    cache, sync, settings, getProvider: () => provider, isOnline: () => true,
  });
  return { cache, provider, sync, vm };
}

describe("ViewModel", () => {
  let ctx: Awaited<ReturnType<typeof build>>;
  beforeEach(async () => { ctx = await build(); });

  it("init picks the first account, loads mailboxes and the first page grouped into threads", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [
      sum("m1", "t1", 1), sum("m2", "t1", 3), sum("m3", "t2", 2),
    ]);
    await ctx.vm.init();
    const s = ctx.vm.getState();
    expect(s.activeAccountId).toBe("a1");
    expect(s.mailboxes.map((m) => m.id)).toContain("INBOX");
    expect(s.threads.map((t) => t.threadId)).toEqual(["t1", "t2"]);
    expect(s.threads[0].messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("selectMailbox reloads the list for that mailbox", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.cache.upsertMessages("a1", [{ ...sum("s1", "ts", 5), mailboxIds: ["SENT"] }]);
    await ctx.vm.init();
    await ctx.vm.selectMailbox("SENT");
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["ts"]);
  });

  it("openThread lazy-loads a body via read-through and caches it", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    const spy = vi.spyOn(ctx.provider, "getMessageBody");
    await ctx.vm.init();
    await ctx.vm.openThread("t1");
    expect(ctx.vm.getState().openMessages[0].body).toBeTruthy();
    expect(await ctx.cache.getBody("a1", "m1")).toBeTruthy();
    await ctx.vm.closeThread();
    await ctx.vm.openThread("t1");
    expect(spy).toHaveBeenCalledTimes(1); // second open hits the cache
  });

  it("runSearch replaces the list and clearSearch restores it", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    ctx.provider.setSearchResults("report", [sum("x1", "tx", 9)]);
    await ctx.vm.init();
    await ctx.vm.runSearch("report");
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["tx"]);
    expect(ctx.vm.getState().search).toEqual({ query: "report", active: true });
    await ctx.vm.clearSearch();
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
  });

  it("runSearch offline sets a notice and does not clear the list", async () => {
    const offlineVm = new ViewModel({
      cache: ctx.cache, sync: ctx.sync, settings: (ctx as never as { settings: SettingsStore }).settings ?? await SettingsStore.load({ loadData: async () => ({ accounts: [{ id: "a1", email: "e", provider: "gmail", clientId: "c", addedAt: 0 }] }), saveData: async () => {} }),
      getProvider: () => ctx.provider, isOnline: () => false,
    });
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await offlineVm.init();
    await offlineVm.runSearch("anything");
    expect(offlineVm.getState().notice).toMatch(/offline/i);
    expect(offlineVm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
  });

  it("re-reads the list when the sync engine emits a change for the active mailbox", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    await ctx.cache.upsertMessages("a1", [sum("m2", "t2", 5)]);
    ctx.sync.changes.emit({ accountId: "a1", mailboxIds: ["INBOX"], reason: "incremental" });
    await new Promise((resolve) => setTimeout(resolve));
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2", "t1"]);
  });
});
