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
  await settings.addAccount({ id: "a1", email: "a1@x.com", provider: "ms-graph", clientId: "c", addedAt: 0 });
  const sync = new SyncEngine({
    cache, cursors, getProvider: () => provider, listAccountIds: () => ["a1"], logger,
  });
  const vm = new ViewModel({
    cache, sync, settings, getProvider: () => provider, isOnline: () => true,
    openExternal: () => {}, saveBlob: async () => {},
  });
  return { cache, provider, sync, settings, vm };
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
      cache: ctx.cache, sync: ctx.sync, settings: (ctx as never as { settings: SettingsStore }).settings ?? await SettingsStore.load({ loadData: async () => ({ accounts: [{ id: "a1", email: "e", provider: "ms-graph", clientId: "c", addedAt: 0 }] }), saveData: async () => {} }),
      getProvider: () => ctx.provider, isOnline: () => false,
      openExternal: () => {}, saveBlob: async () => {},
    });
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await offlineVm.init();
    await offlineVm.runSearch("anything");
    expect(offlineVm.getState().notice).toMatch(/offline/i);
    expect(offlineVm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
  });

  it("renderDeps().getInlineAttachment returns a Blob for an open message's inline attachment", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.cache.putBody("a1", {
      id: "m1", html: '<img src="cid:logo">', text: null, headers: {},
      attachments: [{ id: "att1", filename: "logo.png", mimeType: "image/png", size: 3, inline: true, contentId: "logo" }],
    });
    vi.spyOn(ctx.provider, "getAttachment").mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    await ctx.vm.init();
    await ctx.vm.openThread("t1");
    const blob = await ctx.vm.renderDeps().getInlineAttachment("logo");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.type).toBe("image/png");
  });

  it("renderDeps() returns a stable object identity across calls", () => {
    expect(ctx.vm.renderDeps()).toBe(ctx.vm.renderDeps());
  });

  it("does not advertise hasMore for a short cached list (no auto-fetch on open)", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    const spy = vi.spyOn(ctx.provider, "listMessages");
    await ctx.vm.init();
    // MessageList's sentinel is visible on any short list; hasMore must be
    // false so opening the view doesn't fire an unrequested provider fetch.
    expect(ctx.vm.getState().hasMore).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("advertises hasMore once the cache returns a full page", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    // PAGE * 4 === 200 rows is a full read.
    await ctx.cache.upsertMessages("a1", Array.from({ length: 200 }, (_, i) => sum(`m${i}`, `t${i}`, i)));
    await ctx.vm.init();
    expect(ctx.vm.getState().hasMore).toBe(true);
  });

  it("advertises hasMore for a mailbox the backfill never populated (empty cache)", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    // SENT was never backfilled and has 0 cached rows. hasMore must be true so
    // MessageList renders a load affordance instead of a permanent "No
    // messages".
    await ctx.vm.selectMailbox("SENT");
    expect(ctx.vm.getState().threads).toEqual([]);
    expect(ctx.vm.getState().hasMore).toBe(true);
  });

  it("does not advertise hasMore for a short list once the provider is exhausted", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    // Drain the provider: one short page, no next token => exhausted.
    await ctx.vm.loadMore();
    // backfilled + exhausted + short page => no further load affordance.
    expect(ctx.vm.getState().hasMore).toBe(false);
  });

  it("ignores a stale mailbox read that resolves after a newer one", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.cache.upsertMessages("a1", [{ ...sum("s1", "ts", 5), mailboxIds: ["SENT"] }]);
    await ctx.vm.init();

    // Make INBOX's read resolve *after* SENT's, the way a slow read would.
    const real = ctx.cache.listMailboxMessages.bind(ctx.cache);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.spyOn(ctx.cache, "listMailboxMessages").mockImplementation(async (acct, mb, opts) => {
      if (mb === "INBOX") await gate;
      return real(acct, mb, opts);
    });

    const slow = ctx.vm.selectMailbox("INBOX");
    await ctx.vm.selectMailbox("SENT");
    release();
    await slow;

    expect(ctx.vm.getState().activeMailboxId).toBe("SENT");
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["ts"]);
  });

  it("exposes prefs.autoLoadImages so the renderer can honour it", async () => {
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.vm.init();
    expect(ctx.vm.getState().autoLoadImages).toBe(false);

    await ctx.settings.updatePrefs({ autoLoadImages: true });
    await ctx.vm.refresh();
    expect(ctx.vm.getState().autoLoadImages).toBe(true);
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

describe("ViewModel — composer", () => {
  it("openReply sets mode/targetMessageId and empty recipient/subject fields", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    ctx.vm.openReply("m1", "reply");
    expect(ctx.vm.getState().composer).toEqual({
      mode: "reply", targetMessageId: "m1", draftId: undefined,
      to: [], cc: [], bcc: [], subject: "", sending: false, error: null, bodyHtml: "",
    });
  });

  it("openForward sets mode=forward with the same shape", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    ctx.vm.openForward("m1");
    expect(ctx.vm.getState().composer).toEqual({
      mode: "forward", targetMessageId: "m1", draftId: undefined,
      to: [], cc: [], bcc: [], subject: "", sending: false, error: null, bodyHtml: "",
    });
  });

  it("openNewMessage has no targetMessageId or draftId", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    expect(ctx.vm.getState().composer).toMatchObject({ mode: "new", targetMessageId: undefined, draftId: undefined });
  });

  it("updateComposerFields patches only the given fields", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerFields({ subject: "Hi" });
    ctx.vm.updateComposerFields({ to: [{ email: "a@x.com" }] });
    expect(ctx.vm.getState().composer).toMatchObject({ subject: "Hi", to: [{ email: "a@x.com" }] });
  });

  it("updateComposerBody mirrors the live Quill HTML into state", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerBody("<p>draft text</p>");
    expect(ctx.vm.getState().composer?.bodyHtml).toBe("<p>draft text</p>");
  });

  it("hasUnsavedComposerContent is false with nothing open, true once body text exists", async () => {
    const ctx = await build();
    await ctx.vm.init();
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(false);
    ctx.vm.openNewMessage();
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(false); // empty editor
    ctx.vm.updateComposerBody("<p>hi</p>");
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(true);
  });

  it("closeComposer clears composer with no provider calls", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerBody("<p>hi</p>");
    ctx.vm.closeComposer();
    expect(ctx.vm.getState().composer).toBeNull();
    expect(ctx.provider.sentLog).toEqual([]);
    expect(ctx.provider.drafts.size).toBe(0);
  });
});
