import { describe, it, expect, vi, beforeEach } from "vitest";
import { ViewModel } from "../../src/view/view-model";
import { MailCache } from "../../src/cache/mail-cache";
import { CursorStore } from "../../src/cache/cursor-store";
import { SyncEngine } from "../../src/sync/sync-engine";
import { SettingsStore } from "../../src/settings/settings-store";
import { FakeProvider } from "../../src/providers/fake-provider";
import { Logger } from "../../src/util/logger";
import { AuthError, ContactsConsentRequired } from "../../src/providers/types";
import { contactDeps } from "../helpers/contact-deps";
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
  const showNotice = vi.fn();
  const promptFolderRename = vi.fn();
  const pickNoteAttachment = vi.fn();
  const contacts = contactDeps(() => provider);
  const vm = new ViewModel({
    ...contacts,
    cache, sync, settings, getProvider: () => provider, isOnline: () => true,
    openExternal: () => {}, saveBlob: async () => {}, saveNote: () => {},
    promptFolderName: () => {}, promptFolderRename, pickNoteAttachment, showNotice,
  });
  return { cache, provider, sync, settings, vm, showNotice, promptFolderRename, pickNoteAttachment, contacts };
}

/**
 * Puts a draft in the reading pane the way the UI does: a provider-side draft,
 * a cached summary whose `threadId` is a Graph-style conversation id (never
 * equal to the message's own id), and the thread opened so the summary lands
 * in `openMessages` — the only place `openDraftForEdit` can read it from.
 */
async function openDraftInReadingPane(ctx: Awaited<ReturnType<typeof build>>): Promise<string> {
  await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
  await ctx.vm.init();
  const id = await ctx.provider.createDraft({
    to: [{ email: "a@x.com" }], cc: [{ email: "c@x.com" }], bcc: [{ email: "b@x.com" }],
    subject: "Draft subject", bodyHtml: "<p>draft body</p>",
  });
  await ctx.cache.upsertMessages("a1", [{
    id, threadId: "CONV-draft", mailboxIds: ["DRAFTS"], from: { email: "a1@x.com" },
    to: [{ email: "a@x.com" }], cc: [{ email: "c@x.com" }], bcc: [{ email: "b@x.com" }],
    subject: "Draft subject", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: false,
  }]);
  ctx.provider.getMessageBody = vi.fn().mockResolvedValue({
    id, html: "<p>draft body</p>", text: null, attachments: [], headers: {},
  });
  await ctx.vm.openThread("CONV-draft");
  return id;
}

describe("ViewModel", () => {
  let ctx: Awaited<ReturnType<typeof build>>;
  beforeEach(async () => { ctx = await build(); });

  describe("ribbon prefs", () => {
    const depsFor = (c: Awaited<ReturnType<typeof build>>) => ({
      ...contactDeps(() => c.provider),
      cache: c.cache, sync: c.sync, settings: c.settings, getProvider: () => c.provider, isOnline: () => true,
      openExternal: () => {}, saveBlob: async () => {}, saveNote: () => {},
      promptFolderName: () => {}, promptFolderRename: vi.fn(), pickNoteAttachment: vi.fn(), showNotice: vi.fn(),
    });

    it("reads the stored ribbon prefs at construction, before init()", async () => {
      await ctx.settings.updatePrefs({ ribbonEnabled: false, ribbonCollapsedByDefault: true });
      const fresh = new ViewModel(depsFor(ctx));
      expect(fresh.getState().ribbonEnabled).toBe(false);
      expect(fresh.getState().ribbonCollapsedByDefault).toBe(true);
    });

    it("reports the defaults at construction when nothing was changed", () => {
      const fresh = new ViewModel(depsFor(ctx));
      expect(fresh.getState().ribbonEnabled).toBe(true);
      expect(fresh.getState().ribbonCollapsedByDefault).toBe(false);
    });
  });

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
    const showNotice = vi.fn();
    const offlineVm = new ViewModel({
      ...contactDeps(() => ctx.provider),
      cache: ctx.cache, sync: ctx.sync, settings: (ctx as never as { settings: SettingsStore }).settings ?? await SettingsStore.load({ loadData: async () => ({ accounts: [{ id: "a1", email: "e", provider: "ms-graph", clientId: "c", addedAt: 0 }] }), saveData: async () => {} }),
      getProvider: () => ctx.provider, isOnline: () => false,
      openExternal: () => {}, saveBlob: async () => {}, saveNote: () => {},
      promptFolderName: () => {}, promptFolderRename: () => {}, pickNoteAttachment: async () => undefined, showNotice,
    });
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await offlineVm.init();
    await offlineVm.runSearch("anything");
    expect(showNotice).toHaveBeenCalledWith(expect.stringMatching(/offline/i));
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

  describe("flagging", () => {
    type Ctx = Awaited<ReturnType<typeof build>>;
    async function seed(c: Ctx, msgs: Array<[string, string, number]>) {
      await c.cache.putMailboxes("a1", await c.provider.listMailboxes());
      await c.cache.upsertMessages("a1", msgs.map(([id, t, d]) => sum(id, t, d)));
      for (const [id, t, d] of msgs) c.provider.addMessage(sum(id, t, d));
      await c.vm.init();
    }
    const flaggedInCache = async (c: Ctx, thread: string) =>
      (await c.cache.getThreadMessages("a1", thread)).map((m) => m.flagged);

    it("a thread row is flagged when any of its messages is", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t1", 2]]);
      expect(c.vm.getState().threads[0].flagged).toBe(false);
      await c.cache.patchMessages("a1", [{ id: "m1", mailboxIds: ["INBOX"], flagged: true }]);
      await c.vm.selectMailbox("INBOX");
      expect(c.vm.getState().threads[0].flagged).toBe(true);
    });

    it("toggleMessageFlag flags optimistically — before the server answers — then confirms", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.vm.openThread("t1");
      let release!: () => void;
      const spy = vi.spyOn(c.provider, "setMessageFlag").mockImplementation(
        () => new Promise<void>((res) => { release = res; }),
      );
      const pending = c.vm.toggleMessageFlag("m1");
      await vi.waitFor(() => expect(c.vm.getState().openMessages[0].summary.flagged).toBe(true));
      expect(c.vm.getState().threads[0].flagged).toBe(true);
      expect(await flaggedInCache(c, "t1")).toEqual([true]);
      expect(spy).toHaveBeenCalledWith("m1", true);
      release();
      await pending;
      expect(c.vm.getState().openMessages[0].summary.flagged).toBe(true);
      expect(c.showNotice).not.toHaveBeenCalled();
    });

    it("toggleMessageFlag clears an already-flagged message", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.provider.setMessageFlag("m1", true);
      await c.cache.patchMessages("a1", [{ id: "m1", mailboxIds: ["INBOX"], flagged: true }]);
      await c.vm.openThread("t1");
      const spy = vi.spyOn(c.provider, "setMessageFlag");
      await c.vm.toggleMessageFlag("m1");
      expect(spy).toHaveBeenCalledWith("m1", false);
      expect(c.vm.getState().openMessages[0].summary.flagged).toBe(false);
      expect(await flaggedInCache(c, "t1")).toEqual([false]);
    });

    it("rolls back the cache and the view and toasts when the server rejects", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.vm.openThread("t1");
      vi.spyOn(c.provider, "setMessageFlag").mockRejectedValue(new Error("boom"));
      await c.vm.toggleMessageFlag("m1");
      expect(c.vm.getState().openMessages[0].summary.flagged).toBe(false);
      expect(c.vm.getState().threads[0].flagged).toBe(false);
      expect(await flaggedInCache(c, "t1")).toEqual([false]);
      expect(c.showNotice).toHaveBeenCalledWith("boom");
    });

    it("toggleThreadFlag flags every message when some are unflagged (only the unflagged are sent)", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t1", 2]]);
      await c.cache.patchMessages("a1", [{ id: "m1", mailboxIds: ["INBOX"], flagged: true }]);
      await c.vm.selectMailbox("INBOX");
      const spy = vi.spyOn(c.provider, "setMessageFlag");
      await c.vm.toggleThreadFlag("t1");
      expect(spy.mock.calls).toEqual([["m2", true]]);
      expect(await flaggedInCache(c, "t1")).toEqual([true, true]);
      expect(c.vm.getState().threads[0].flagged).toBe(true);
    });

    it("toggleThreadFlag clears every message when they are all flagged", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t1", 2]]);
      await c.cache.patchMessages("a1", [
        { id: "m1", mailboxIds: ["INBOX"], flagged: true }, { id: "m2", mailboxIds: ["INBOX"], flagged: true },
      ]);
      await c.vm.selectMailbox("INBOX");
      const spy = vi.spyOn(c.provider, "setMessageFlag");
      await c.vm.toggleThreadFlag("t1");
      expect(spy.mock.calls.map((a) => a[1])).toEqual([false, false]);
      expect(await flaggedInCache(c, "t1")).toEqual([false, false]);
      expect(c.vm.getState().threads[0].flagged).toBe(false);
    });

    it("a partial thread failure rolls back only the failed messages and reports N of M", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t1", 2]]);
      vi.spyOn(c.provider, "setMessageFlag").mockImplementation(async (id: string) => {
        if (id === "m2") throw new Error("boom");
      });
      await c.vm.toggleThreadFlag("t1");
      expect(await flaggedInCache(c, "t1")).toEqual([true, false]);
      expect(c.showNotice).toHaveBeenCalledWith(expect.stringMatching(/1 of 2/));
    });

    it("a total thread failure rolls everything back and toasts the reason", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t1", 2]]);
      vi.spyOn(c.provider, "setMessageFlag").mockRejectedValue(new AuthError("expired"));
      await c.vm.toggleThreadFlag("t1");
      expect(await flaggedInCache(c, "t1")).toEqual([false, false]);
      expect(c.vm.getState().threads[0].flagged).toBe(false);
      expect(c.showNotice).toHaveBeenCalledWith(expect.stringMatching(/reauthentication/i));
    });

    it("updates a search-result row in place (search results aren't cache-derived)", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      c.provider.setSearchResults("q", [sum("m1", "t1", 1)]);
      await c.vm.runSearch("q");
      await c.vm.toggleThreadFlag("t1");
      expect(c.vm.getState().search.active).toBe(true);
      expect(c.vm.getState().threads[0].flagged).toBe(true);
    });

    it("toggleMessageFlag for a message that isn't open toasts instead of throwing", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.vm.toggleMessageFlag("nope");
      expect(c.showNotice).toHaveBeenCalledWith(expect.stringMatching(/couldn't find/i));
    });

    it("toggleThreadFlag for an unknown thread toasts instead of throwing", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.vm.toggleThreadFlag("nope");
      expect(c.showNotice).toHaveBeenCalledWith(expect.stringMatching(/couldn't find/i));
    });
  });

  describe("pinning", () => {
    type Ctx = Awaited<ReturnType<typeof build>>;
    async function seed(c: Ctx, msgs: Array<[string, string, number]>) {
      await c.cache.putMailboxes("a1", await c.provider.listMailboxes());
      await c.cache.upsertMessages("a1", msgs.map(([id, t, d]) => sum(id, t, d)));
      for (const [id, t, d] of msgs) c.provider.addMessage(sum(id, t, d));
    }

    it("a pinned thread sorts first even when older, and is marked pinned", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t2", 2], ["m3", "t3", 3]]);
      await c.settings.pin("a1", "t1");
      await c.vm.init();
      const threads = c.vm.getState().threads;
      expect(threads.map((t) => t.threadId)).toEqual(["t1", "t3", "t2"]);
      expect(threads.map((t) => t.pinned)).toEqual([true, false, false]);
      expect(c.vm.getState().pinnedThreadIds).toEqual(["t1"]);
    });

    it("several pinned threads keep newest-activity order among themselves", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t2", 2], ["m3", "t3", 3]]);
      await c.settings.pin("a1", "t1");
      await c.settings.pin("a1", "t2");
      await c.vm.init();
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2", "t1", "t3"]);
    });

    it("toggleThreadPin pins and unpins, persists, and re-sorts the list", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t2", 2]]);
      await c.vm.init();
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2", "t1"]);
      await c.vm.toggleThreadPin("t1");
      expect(c.settings.isPinned("a1", "t1")).toBe(true);
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1", "t2"]);
      expect(c.vm.getState().pinnedThreadIds).toEqual(["t1"]);
      await c.vm.toggleThreadPin("t1");
      expect(c.settings.isPinned("a1", "t1")).toBe(false);
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2", "t1"]);
      expect(c.vm.getState().pinnedThreadIds).toEqual([]);
    });

    it("a pinned thread older than the loaded page still appears, at the top", async () => {
      const c = await build();
      const many: Array<[string, string, number]> = Array.from({ length: 205 }, (_, i) => [`n${i}`, `tn${i}`, 1000 + i]);
      await seed(c, [["old", "t-old", 1], ...many]);
      await c.settings.pin("a1", "t-old");
      await c.vm.init();
      const threads = c.vm.getState().threads;
      expect(threads[0].threadId).toBe("t-old");
      expect(threads).toHaveLength(201); // the 200 newest + the pinned extra
    });

    it("a pinned thread appears only in mailboxes that hold its messages", async () => {
      const c = await build();
      await c.cache.putMailboxes("a1", await c.provider.listMailboxes());
      await c.cache.upsertMessages("a1", [
        sum("m1", "t1", 5),
        { ...sum("m2", "t2", 1), mailboxIds: ["SENT"] },
      ]);
      await c.settings.pin("a1", "t2");
      await c.vm.init();
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
      await c.vm.selectMailbox("SENT");
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2"]);
    });

    it("search results show the pin but are not reordered", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t2", 2]]);
      await c.settings.pin("a1", "t1");
      await c.vm.init();
      c.provider.setSearchResults("q", [sum("m2", "t2", 2), sum("m1", "t1", 1)]);
      await c.vm.runSearch("q");
      const threads = c.vm.getState().threads;
      expect(threads.map((t) => t.threadId)).toEqual(["t2", "t1"]);
      expect(threads.find((t) => t.threadId === "t1")!.pinned).toBe(true);
    });

    it("toggling a pin while searching updates the pin mark in place", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.vm.init();
      c.provider.setSearchResults("q", [sum("m1", "t1", 1)]);
      await c.vm.runSearch("q");
      await c.vm.toggleThreadPin("t1");
      expect(c.vm.getState().search.active).toBe(true);
      expect(c.vm.getState().threads[0].pinned).toBe(true);
    });

    it("a failed save reverts the pin and toasts", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.vm.init();
      vi.spyOn(c.settings, "pin").mockRejectedValue(new Error("disk full"));
      await c.vm.toggleThreadPin("t1");
      expect(c.vm.getState().pinnedThreadIds).toEqual([]);
      expect(c.vm.getState().threads[0].pinned).toBe(false);
      expect(c.showNotice).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    });

    it("pins are per account: another account's pin doesn't mark this one's thread", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.settings.pin("other-account", "t1");
      await c.vm.init();
      expect(c.vm.getState().threads[0].pinned).toBe(false);
      expect(c.vm.getState().pinnedThreadIds).toEqual([]);
    });
  });

  describe("flagged view", () => {
    type Ctx = Awaited<ReturnType<typeof build>>;
    const flaggedMsg = (id: string, thread: string, date: number, extra: Partial<MessageSummary> = {}): MessageSummary =>
      ({ ...sum(id, thread, date), flagged: true, ...extra });
    /** `cached` rows go into the cache; `server` rows into the fake provider. */
    async function seed(c: Ctx, cached: MessageSummary[], server: MessageSummary[] = cached) {
      await c.cache.putMailboxes("a1", [
        ...(await c.provider.listMailboxes()),
        { id: "TRASH", name: "Deleted Items", kind: "trash" },
      ]);
      await c.cache.upsertMessages("a1", cached);
      for (const m of server) c.provider.addMessage(m);
    }

    it("selectFlagged lists cached flagged threads across mailboxes, newest first, excluding unflagged and Trash", async () => {
      const c = await build();
      await seed(c, [
        flaggedMsg("f1", "t1", 5),
        flaggedMsg("f2", "t2", 9, { mailboxIds: ["SENT"] }),
        sum("plain", "t3", 10),
        flaggedMsg("gone", "t4", 12, { mailboxIds: ["TRASH"] }),
      ]);
      await c.vm.init();
      await c.vm.selectFlagged();
      expect(c.vm.getState().flaggedActive).toBe(true);
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2", "t1"]);
    });

    it("fetches the rest from the server and caches it", async () => {
      const c = await build();
      await seed(c, [], [flaggedMsg("old", "t-old", 1)]);
      await c.vm.init();
      await c.vm.selectFlagged();
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t-old"]);
      expect((await c.cache.getThreadMessages("a1", "t-old")).map((m) => m.id)).toEqual(["old"]);
    });

    it("shows the cached rows before the server answers", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)], []);
      await c.vm.init();
      let release!: () => void;
      const spy = vi.spyOn(c.provider, "listFlaggedMessages").mockImplementation(
        () => new Promise((res) => { release = () => res({ items: [] }); }),
      );
      const pending = c.vm.selectFlagged();
      // The server request is in flight (unanswered), and the cached row is already showing.
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
      release();
      await pending;
      expect(c.vm.getState().loadingList).toBe(false);
    });

    it("offline: shows the cached list, makes no request, and stays quiet", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)]);
      // Same construction the existing offline-search test uses (see `offlineVm`
      // near the top of this file): the shared deps with `isOnline: () => false`.
      const offline = new ViewModel({
        cache: c.cache, sync: c.sync, settings: c.settings, getProvider: () => c.provider, isOnline: () => false,
        openExternal: () => {}, saveBlob: async () => {}, saveNote: () => {},
        promptFolderName: () => {}, promptFolderRename: vi.fn(), pickNoteAttachment: vi.fn(), showNotice: c.showNotice,
        ...contactDeps(() => c.provider),
      });
      const spy = vi.spyOn(c.provider, "listFlaggedMessages");
      await offline.init();
      await offline.selectFlagged();
      expect(offline.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
      expect(spy).not.toHaveBeenCalled();
      expect(c.showNotice).not.toHaveBeenCalled();
    });

    it("a server failure keeps the cached list and toasts", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)]);
      await c.vm.init();
      vi.spyOn(c.provider, "listFlaggedMessages").mockRejectedValue(new Error("boom"));
      await c.vm.selectFlagged();
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
      expect(c.showNotice).toHaveBeenCalledWith(expect.stringMatching(/couldn't load flagged/i));
    });

    it("Load more follows the server's page token", async () => {
      const c = await build();
      c.provider.pageSize = 2;
      await seed(c, [], [flaggedMsg("a", "ta", 3), flaggedMsg("b", "tb", 2), flaggedMsg("c", "tc", 1)]);
      await c.vm.init();
      await c.vm.selectFlagged();
      expect(c.vm.getState().threads).toHaveLength(2);
      expect(c.vm.getState().hasMore).toBe(true);
      await c.vm.loadMore();
      expect(c.vm.getState().threads).toHaveLength(3);
      expect(c.vm.getState().hasMore).toBe(false);
    });

    it("unflagging inside the view removes the row; a server failure puts it back", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)]);
      await c.vm.init();
      await c.vm.selectFlagged();
      await c.vm.toggleThreadFlag("t1");
      expect(c.vm.getState().threads).toEqual([]);

      await c.vm.toggleThreadFlag("t1"); // flag it again: the row returns
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);

      // A rejected unflag is rolled back in the cache, and the list re-derives.
      vi.spyOn(c.provider, "setMessageFlag").mockRejectedValue(new Error("boom"));
      await c.vm.toggleThreadFlag("t1");
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]); // rolled back
    });

    it("pinned threads still float to the top of the flagged list", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 1), flaggedMsg("f2", "t2", 9)]);
      await c.settings.pin("a1", "t1");
      await c.vm.init();
      await c.vm.selectFlagged();
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1", "t2"]);
    });

    it("selectMailbox leaves the view and lists that mailbox again", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5), sum("m2", "t2", 6)]);
      await c.vm.init();
      await c.vm.selectFlagged();
      await c.vm.selectMailbox("INBOX");
      expect(c.vm.getState().flaggedActive).toBe(false);
      expect(c.vm.getState().threads.map((t) => t.threadId).sort()).toEqual(["t1", "t2"]);
    });

    it("selectFlagged clears an active search and a composer, like selectMailbox", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)]);
      await c.vm.init();
      c.provider.setSearchResults("q", [sum("m9", "t9", 1)]);
      await c.vm.runSearch("q");
      c.vm.openNewMessage();
      await c.vm.selectFlagged();
      expect(c.vm.getState().search.active).toBe(false);
      expect(c.vm.getState().composer).toBeNull();
    });

    it("clearing a search made inside the view returns to the flagged list", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)]);
      await c.vm.init();
      await c.vm.selectFlagged();
      c.provider.setSearchResults("q", [sum("m9", "t9", 1)]);
      await c.vm.runSearch("q");
      await c.vm.clearSearch();
      expect(c.vm.getState().flaggedActive).toBe(true);
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
    });

    it("a folder vanishing during sync does not knock the user out of the view", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)]);
      await c.vm.init();
      await c.vm.selectFlagged();
      await c.cache.deleteMailboxes("a1", ["INBOX"]); // the previously active real mailbox disappears
      c.sync.changes.emit({ accountId: "a1", mailboxIds: [], reason: "incremental" });
      await new Promise((r) => setTimeout(r, 30));
      expect(c.vm.getState().flaggedActive).toBe(true);
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
    });

    it("refresh re-fetches the flagged list", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)]);
      await c.vm.init();
      await c.vm.selectFlagged();
      const spy = vi.spyOn(c.provider, "listFlaggedMessages");
      await c.vm.refresh();
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  describe("contacts", () => {
    const ada = { id: "C1", displayName: "Ada Lovelace", emails: [{ email: "ada@x.com" }], businessPhones: [], homePhones: [], companyName: "Engines" };

    async function start() {
      await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
      await ctx.contacts.contactStore.put("a1", ada);
      await ctx.vm.init();
      return ctx.vm;
    }

    it("loads the active account's cached contacts on init and starts in mail mode", async () => {
      const vm = await start();
      expect(vm.getState().mode).toBe("mail");
      expect(vm.getState().contacts.map((c) => c.id)).toEqual(["C1"]);
      expect(vm.getState().contactsStatus).toBe("idle");
    });

    it("reloads contacts when ContactSync reports a change, and mirrors its status", async () => {
      const vm = await start();
      ctx.provider.seedContacts([ada, { ...ada, id: "C2", displayName: "Bob" }]);
      await ctx.contacts.contactSync.syncAccount("a1", { force: true });
      await vi.waitFor(() => expect(vm.getState().contacts.map((c) => c.id)).toEqual(["C1", "C2"]));
      ctx.contacts.contactSync.markNeedsConsent("a1");
      expect(vm.getState().contactsStatus).toBe("needs-consent");
    });

    it("setMode('contacts') drops the composer and force-syncs; setMode('mail') returns", async () => {
      const vm = await start();
      const spy = vi.spyOn(ctx.provider, "listContacts");
      vm.openNewMessage();
      vm.setMode("contacts");
      expect(vm.getState().mode).toBe("contacts");
      expect(vm.getState().composer).toBeNull();
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());
      vm.setMode("mail");
      expect(vm.getState().mode).toBe("mail");
    });

    it("selectContact selects and clears any edit; searchContacts stores the query", async () => {
      const vm = await start();
      vm.selectContact("C1");
      expect(vm.getState().selectedContactId).toBe("C1");
      vm.searchContacts("ada");
      expect(vm.getState().contactSearch).toBe("ada");
    });

    it("newContact opens a blank edit; hasUnsavedContactEdit tracks changes", async () => {
      const vm = await start();
      vm.newContact();
      expect(vm.getState().contactEdit).toMatchObject({ mode: "new", error: null, saving: false });
      expect(vm.hasUnsavedContactEdit()).toBe(false);
      vm.updateContactDraft({ givenName: "Zed" });
      expect(vm.hasUnsavedContactEdit()).toBe(true);
      vm.cancelContactEdit();
      expect(vm.getState().contactEdit).toBeNull();
      expect(vm.hasUnsavedContactEdit()).toBe(false);
    });

    it("every newContact/editContact gets a fresh seq so the form remounts", async () => {
      const vm = await start();
      vm.newContact();
      const first = vm.getState().contactEdit!.seq;
      vm.cancelContactEdit();
      vm.newContact();
      const second = vm.getState().contactEdit!.seq;
      expect(second).not.toBe(first);
      vm.editContact("C1");
      expect(vm.getState().contactEdit!.seq).not.toBe(second);
    });

    it("saving a new contact creates it server-first, caches it, and selects it", async () => {
      const vm = await start();
      vm.newContact();
      vm.updateContactDraft({ givenName: "Grace", surname: "Hopper", emails: [{ email: "grace@x.com" }] });
      await vm.saveContact();
      const created = vm.getState().contacts.find((c) => c.displayName === "Grace Hopper")!;
      expect(created).toBeTruthy();
      expect(vm.getState().selectedContactId).toBe(created.id);
      expect(vm.getState().contactEdit).toBeNull();
      expect((await ctx.contacts.contactStore.list("a1")).map((c) => c.id)).toContain(created.id);
      expect((await ctx.provider.listContacts()).map((c) => c.id)).toContain(created.id);
    });

    it("saving an edit sends only the changed fields", async () => {
      const vm = await start();
      ctx.provider.seedContacts([ada]);
      const spy = vi.spyOn(ctx.provider, "updateContact");
      vm.editContact("C1");
      vm.updateContactDraft({ jobTitle: "Countess" });
      await vm.saveContact();
      expect(spy).toHaveBeenCalledWith("C1", { jobTitle: "Countess" });
      expect(vm.getState().contacts.find((c) => c.id === "C1")?.jobTitle).toBe("Countess");
      expect(vm.getState().contactEdit).toBeNull();
    });

    it("a cache write that fails after a successful create doesn't duplicate the contact", async () => {
      const vm = await start();
      const create = vi.spyOn(ctx.provider, "createContact");
      vi.spyOn(ctx.contacts.contactStore, "put").mockRejectedValue(new Error("QuotaExceededError"));
      vm.newContact();
      vm.updateContactDraft({ givenName: "Grace", surname: "Hopper" });
      await vm.saveContact();

      // The server write succeeded, so the form must close and the contact
      // must appear — a re-Save here would create a second one server-side.
      expect(create).toHaveBeenCalledOnce();
      expect(vm.getState().contactEdit).toBeNull();
      expect(vm.getState().contacts.map((c) => c.displayName)).toContain("Grace Hopper");
      expect(ctx.showNotice).not.toHaveBeenCalled();
    });

    it("a cache removal that fails after a successful delete still drops the contact", async () => {
      const vm = await start();
      ctx.provider.seedContacts([ada]);
      const del = vi.spyOn(ctx.provider, "deleteContact");
      vi.spyOn(ctx.contacts.contactStore, "remove").mockRejectedValue(new Error("QuotaExceededError"));
      vm.selectContact("C1");
      await vm.deleteContact("C1");

      expect(del).toHaveBeenCalledOnce();
      expect(vm.getState().contacts).toEqual([]);
      expect(vm.getState().selectedContactId).toBeNull();
      expect(ctx.showNotice).not.toHaveBeenCalled();
    });

    it("the update patch is diffed against what the form was seeded from, not the live cache", async () => {
      const vm = await start();
      ctx.provider.seedContacts([{ ...ada, jobTitle: "Dev" }]);
      await ctx.contacts.contactSync.syncAccount("a1", { force: true });
      await vi.waitFor(() => expect(vm.getState().contacts[0].jobTitle).toBe("Dev"));

      vm.editContact("C1");

      // A remote edit lands mid-edit and replaces state.contacts.
      ctx.provider.seedContacts([{ ...ada, jobTitle: "Lead" }]);
      await ctx.contacts.contactSync.syncAccount("a1", { force: true });
      await vi.waitFor(() => expect(vm.getState().contacts[0].jobTitle).toBe("Lead"));

      const spy = vi.spyOn(ctx.provider, "updateContact");
      vm.updateContactDraft({ notes: "n" });
      await vm.saveContact();

      // Only the field the user touched — the stale "Dev" must not revert "Lead".
      expect(spy).toHaveBeenCalledWith("C1", { notes: "n" });
    });

    it("saving with no changes makes no server call", async () => {
      const vm = await start();
      const spy = vi.spyOn(ctx.provider, "updateContact");
      vm.editContact("C1");
      await vm.saveContact();
      expect(spy).not.toHaveBeenCalled();
      expect(vm.getState().contactEdit).toBeNull();
    });

    it("an invalid draft stays open with a message and makes no server call", async () => {
      const vm = await start();
      const spy = vi.spyOn(ctx.provider, "createContact");
      vm.newContact();
      await vm.saveContact();
      expect(spy).not.toHaveBeenCalled();
      expect(vm.getState().contactEdit?.error).toMatch(/name or an email/i);
    });

    it("a failed save toasts and keeps the form and its input", async () => {
      const vm = await start();
      ctx.provider.contactsError = new Error("network down");
      vm.newContact();
      vm.updateContactDraft({ givenName: "Grace" });
      await vm.saveContact();
      expect(ctx.showNotice).toHaveBeenCalledWith("network down");
      expect(vm.getState().contactEdit).toMatchObject({ saving: false, draft: { givenName: "Grace" } });
    });

    it("a consent failure marks the account needs-consent and toasts a grant hint", async () => {
      const vm = await start();
      ctx.provider.contactsError = new ContactsConsentRequired();
      vm.newContact();
      vm.updateContactDraft({ givenName: "Grace" });
      await vm.saveContact();
      expect(vm.getState().contactsStatus).toBe("needs-consent");
      expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringMatching(/grant contacts access/i));
    });

    it("deleteContact removes it server-side and locally, clearing the selection", async () => {
      const vm = await start();
      ctx.provider.seedContacts([ada]);
      vm.selectContact("C1");
      await vm.deleteContact("C1");
      expect(vm.getState().contacts).toEqual([]);
      expect(vm.getState().selectedContactId).toBeNull();
      expect(await ctx.contacts.contactStore.list("a1")).toEqual([]);
      expect(await ctx.provider.listContacts()).toEqual([]);
    });

    it("emailContact opens a new composer addressed to the contact and returns to mail mode", async () => {
      const vm = await start();
      vm.setMode("contacts");
      vm.emailContact("C1");
      expect(vm.getState().mode).toBe("mail");
      expect(vm.getState().composer).toMatchObject({ mode: "new", to: [{ name: "Ada Lovelace", email: "ada@x.com" }] });
    });

    it("a contact-addressed composer isn't unsaved until the user changes something", async () => {
      const vm = await start();
      vm.setMode("contacts");
      vm.emailContact("C1");
      expect(vm.hasUnsavedComposerContent()).toBe(false);
      vm.updateComposerBody("<p>hello</p>");
      expect(vm.hasUnsavedComposerContent()).toBe(true);
    });

    it("emailContact uses a specific address when given, and toasts if the contact has none", async () => {
      const vm = await start();
      await ctx.contacts.contactStore.put("a1", { ...ada, id: "C3", displayName: "Nomail", emails: [] });
      await vm.selectAccount("a1");
      vm.emailContact("C1", "other@x.com");
      expect(vm.getState().composer?.to).toEqual([{ name: "Ada Lovelace", email: "other@x.com" }]);
      vm.closeComposer();
      vm.emailContact("C3");
      expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringMatching(/no email/i));
      expect(vm.getState().composer).toBeNull();
    });

    it("suggestRecipients ranks the active account's contacts", async () => {
      const vm = await start();
      expect(vm.suggestRecipients("ada")).toEqual([{ name: "Ada Lovelace", email: "ada@x.com" }]);
      expect(vm.suggestRecipients("ada", ["ada@x.com"])).toEqual([]);
    });

    it("refreshContacts force-syncs and toasts on failure", async () => {
      const vm = await start();
      ctx.provider.contactsError = new Error("offline");
      await vm.refreshContacts();
      expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringContaining("offline"));
    });

    it("refreshContacts isn't a silent no-op when access hasn't been granted", async () => {
      const vm = await start();
      ctx.provider.contactsError = new ContactsConsentRequired();
      await vm.refreshContacts();
      expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringMatching(/grant contacts access/i));

      ctx.showNotice.mockClear();
      ctx.provider.contactsError = new AuthError("Graph 401");
      await vm.refreshContacts();
      // A failed sign-in is not a missing grant — point at re-authentication, not "grant".
      expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringMatching(/re-authenticate/i));
      expect(ctx.showNotice).not.toHaveBeenCalledWith(expect.stringMatching(/hasn't been granted/i));
    });

    it("grantContactsAccess delegates to the host with the active account", async () => {
      const vm = await start();
      await vm.grantContactsAccess();
      expect(ctx.contacts.grantContactsAccess).toHaveBeenCalledWith("a1");
    });

    it("switching accounts clears the selection, edit and search", async () => {
      const vm = await start();
      vm.selectContact("C1");
      vm.searchContacts("x");
      await vm.selectAccount("a1");
      expect(vm.getState()).toMatchObject({ selectedContactId: null, contactEdit: null, contactSearch: "" });
    });
  });
});

describe("ViewModel — navigation closes the composer", () => {
  let ctx: Awaited<ReturnType<typeof build>>;
  beforeEach(async () => {
    ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1), sum("m2", "t2", 2)]);
    await ctx.vm.init();
  });

  it("openThread clears an untouched composer so the reading pane shows the thread", async () => {
    ctx.vm.openNewMessage();
    await ctx.vm.openThread("t1");
    // ReadingPane renders a new/editDraft composer *instead of* the message
    // list, so a stale one left open hides the thread that just loaded.
    expect(ctx.vm.getState().composer).toBeNull();
    expect(ctx.vm.getState().openMessages.map((m) => m.summary.id)).toEqual(["m1"]);
  });

  it("openThread clears a reply composer whose target is no longer rendered", async () => {
    await ctx.vm.openThread("t1");
    ctx.vm.openReply("m1", "reply");
    await ctx.vm.openThread("t2");
    expect(ctx.vm.getState().composer).toBeNull();
  });

  it("closeThread clears the composer", async () => {
    await ctx.vm.openThread("t1");
    ctx.vm.openReply("m1", "reply");
    ctx.vm.closeThread();
    expect(ctx.vm.getState().composer).toBeNull();
  });

  it("selectMailbox clears the composer and still loads the new mailbox", async () => {
    ctx.vm.openNewMessage();
    await ctx.vm.selectMailbox("SENT");
    expect(ctx.vm.getState().composer).toBeNull();
    expect(ctx.vm.getState().activeMailboxId).toBe("SENT");
  });

  it("selectAccount clears the composer", async () => {
    ctx.vm.openNewMessage();
    await ctx.vm.selectAccount("a1");
    expect(ctx.vm.getState().composer).toBeNull();
  });

  it("clearing the composer on navigation never deletes the draft behind it", async () => {
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerBody("<p>saved once</p>");
    await ctx.vm.saveDraft();
    const draftId = ctx.vm.getState().composer?.draftId!;
    await ctx.vm.selectMailbox("SENT");
    expect(ctx.vm.getState().composer).toBeNull();
    expect(ctx.provider.drafts.has(draftId)).toBe(true);
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
      to: [], cc: [], bcc: [], subject: "", sending: false, error: null, bodyHtml: "", attachments: [],
      savedSnapshot: null,
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
      to: [], cc: [], bcc: [], subject: "", sending: false, error: null, bodyHtml: "", attachments: [],
      savedSnapshot: null,
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

  it("hasUnsavedComposerContent is true for a new message with recipients but an empty body", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerFields({ to: [{ email: "a@x.com" }], subject: "Hi" });
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(true);
  });

  it("hasUnsavedComposerContent is false for an untouched draft opened for edit", async () => {
    const ctx = await build();
    const id = await openDraftInReadingPane(ctx);
    await ctx.vm.openDraftForEdit(id);
    // Nothing edited yet: switching away must not prompt, because answering
    // "Discard" there would delete a draft the user never changed.
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(false);
    // Quill re-emits its own serialization of the loaded body on mount.
    ctx.vm.updateComposerBody("<p>draft body</p>");
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(false);
  });

  it("openDraftForEdit leaves contacts mode", async () => {
    const ctx = await build();
    const id = await openDraftInReadingPane(ctx);
    ctx.vm.setMode("contacts");
    await ctx.vm.openDraftForEdit(id);
    expect(ctx.vm.getState().mode).toBe("mail");
    expect(ctx.vm.getState().composer?.mode).toBe("editDraft");
  });

  it("hasUnsavedComposerContent is true when only the subject of an open draft changed", async () => {
    const ctx = await build();
    const id = await openDraftInReadingPane(ctx);
    await ctx.vm.openDraftForEdit(id);
    ctx.vm.updateComposerFields({ subject: "Draft subject (edited)" });
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(true);
  });

  it("hasUnsavedComposerContent resets to false after a successful saveDraft", async () => {
    const ctx = await build();
    const id = await openDraftInReadingPane(ctx);
    await ctx.vm.openDraftForEdit(id);
    ctx.vm.updateComposerFields({ cc: [{ email: "extra@x.com" }] });
    ctx.vm.updateComposerBody("<p>edited</p>");
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(true);
    await ctx.vm.saveDraft();
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(false);
  });

  it("hasUnsavedComposerContent stays true after a failed saveDraft", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerBody("<p>hi</p>");
    vi.spyOn(ctx.provider, "createDraft").mockRejectedValue(new Error("network down"));
    await ctx.vm.saveDraft();
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(true);
  });

  it("openComposeFromNote opens a new composer pre-filled with a subject and rendered body", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openComposeFromNote("My Note", "<h1>My Note</h1><p>content</p>");
    const c = ctx.vm.getState().composer;
    expect(c?.mode).toBe("new");
    expect(c?.subject).toBe("My Note");
    expect(c?.bodyHtml).toBe("<h1>My Note</h1><p>content</p>");
    expect(c?.attachments).toEqual([]);
  });

  it("openComposeFromNote's pre-filled content counts as unsaved, so closing would warn", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openComposeFromNote("My Note", "<p>content</p>");
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(true);
  });

  it("openComposeWithAttachment opens a blank new composer with the note staged as an attachment", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openComposeWithAttachment({ filename: "My Note.md", mimeType: "text/markdown", contentBytes: "aGk=" });
    const c = ctx.vm.getState().composer;
    expect(c?.mode).toBe("new");
    expect(c?.subject).toBe("");
    expect(c?.bodyHtml).toBe("");
    expect(c?.attachments).toEqual([{ filename: "My Note.md", mimeType: "text/markdown", contentBytes: "aGk=" }]);
  });

  it("a staged attachment alone counts as unsaved content, even with no typed text", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openComposeWithAttachment({ filename: "My Note.md", mimeType: "text/markdown", contentBytes: "aGk=" });
    expect(ctx.vm.hasUnsavedComposerContent()).toBe(true);
  });

  it("removeComposerAttachment removes just the given attachment", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openComposeWithAttachment({ filename: "a.md", mimeType: "text/markdown", contentBytes: "YQ==" });
    ctx.vm.removeComposerAttachment(0);
    expect(ctx.vm.getState().composer?.attachments).toEqual([]);
  });

  it("send includes staged attachments in a new message", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openComposeWithAttachment({ filename: "note.md", mimeType: "text/markdown", contentBytes: "aGk=" });
    ctx.vm.updateComposerFields({ to: [{ email: "a@x.com" }] });
    const sendSpy = vi.spyOn(ctx.provider, "sendNewMessage");
    await ctx.vm.send();
    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [{ filename: "note.md", mimeType: "text/markdown", contentBytes: "aGk=" }],
    }));
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

  it("send sanitizes the body and dispatches to sendNewMessage for mode=new", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerFields({ to: [{ email: "a@x.com" }], subject: "Hi" });
    ctx.vm.updateComposerBody('<p>hi<script>alert(1)</script></p>');
    await ctx.vm.send();
    expect(ctx.provider.sentLog).toEqual([{
      kind: "new",
      message: { to: [{ email: "a@x.com" }], cc: [], bcc: [], subject: "Hi", bodyHtml: "<p>hi</p>" },
    }]);
    expect(ctx.vm.getState().composer).toBeNull();
    expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringMatching(/sent/i));
  });

  it("send dispatches to replyToMessage for mode=reply/replyAll", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    ctx.vm.openReply("m1", "replyAll");
    ctx.vm.updateComposerBody("<p>thanks</p>");
    await ctx.vm.send();
    expect(ctx.provider.sentLog).toEqual([{ kind: "reply", targetId: "m1", mode: "replyAll", commentHtml: "<p>thanks</p>" }]);
  });

  it("send dispatches to forwardMessage for mode=forward, using the to field", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    ctx.vm.openForward("m1");
    ctx.vm.updateComposerFields({ to: [{ email: "c@x.com" }] });
    ctx.vm.updateComposerBody("<p>fyi</p>");
    await ctx.vm.send();
    expect(ctx.provider.sentLog).toEqual([{ kind: "forward", targetId: "m1", commentHtml: "<p>fyi</p>", to: [{ email: "c@x.com" }] }]);
  });

  it("send for mode=editDraft updates then sends the draft, then clears the composer", async () => {
    const ctx = await build();
    const id = await openDraftInReadingPane(ctx);
    await ctx.vm.openDraftForEdit(id);
    ctx.vm.updateComposerFields({ subject: "new" });
    ctx.vm.updateComposerBody("<p>new</p>");
    await ctx.vm.send();
    expect(ctx.provider.drafts.has(id)).toBe(false);
    expect(ctx.provider.sentLog).toContainEqual({ kind: "draft", draftId: id });
    expect(ctx.vm.getState().composer).toBeNull();
  });

  it("send keeps the composer open with an error on failure, without clearing content", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerBody("<p>hi</p>");
    vi.spyOn(ctx.provider, "sendNewMessage").mockRejectedValue(new Error("network down"));
    await ctx.vm.send();
    expect(ctx.vm.getState().composer).toMatchObject({ bodyHtml: "<p>hi</p>", error: expect.stringContaining("network down") });
  });

  it("send surfaces a re-authenticate hint on AuthError", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerBody("<p>hi</p>");
    vi.spyOn(ctx.provider, "sendNewMessage").mockRejectedValue(new AuthError("Graph 401"));
    await ctx.vm.send();
    expect(ctx.vm.getState().composer?.error).toMatch(/re-authenticate/i);
  });

  it("saveDraft creates a draft the first time and PATCHes the same id on the second save", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerFields({ subject: "S" });
    ctx.vm.updateComposerBody("<p>v1</p>");
    await ctx.vm.saveDraft();
    const id = ctx.vm.getState().composer?.draftId;
    expect(id).toBeTruthy();
    expect(ctx.provider.drafts.get(id!)).toMatchObject({ bodyHtml: "<p>v1</p>" });

    ctx.vm.updateComposerBody("<p>v2</p>");
    await ctx.vm.saveDraft();
    expect(ctx.provider.drafts.size).toBe(1); // same draft, updated in place
    expect(ctx.provider.drafts.get(id!)).toMatchObject({ bodyHtml: "<p>v2</p>" });
    expect(ctx.vm.getState().composer?.draftId).toBe(id); // composer stays open after a save
  });

  it("send after autosave for mode=new cleans up the stale draft", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerFields({ to: [{ email: "a@x.com" }], subject: "Hi" });
    ctx.vm.updateComposerBody("<p>hi</p>");
    await ctx.vm.saveDraft();
    const draftId = ctx.vm.getState().composer?.draftId!;
    expect(ctx.provider.drafts.has(draftId)).toBe(true);

    await ctx.vm.send();
    expect(ctx.provider.drafts.has(draftId)).toBe(false);
    expect(ctx.provider.sentLog).toContainEqual({
      kind: "new",
      message: { to: [{ email: "a@x.com" }], cc: [], bcc: [], subject: "Hi", bodyHtml: "<p>hi</p>" },
    });
  });

  it("discardDraft deletes a persisted draft and clears the composer", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.updateComposerBody("<p>v1</p>");
    await ctx.vm.saveDraft();
    const id = ctx.vm.getState().composer?.draftId!;
    await ctx.vm.discardDraft();
    expect(ctx.provider.drafts.has(id)).toBe(false);
    expect(ctx.vm.getState().composer).toBeNull();
  });

  it("discardDraft on a never-saved composer just clears it (no provider call)", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openReply("does-not-matter", "reply");
    ctx.vm.updateComposerBody("<p>hi</p>");
    await ctx.vm.discardDraft();
    expect(ctx.vm.getState().composer).toBeNull();
    expect(ctx.provider.drafts.size).toBe(0);
  });

  it("openDraftForEdit prefills from the open message even though the draft's threadId is not its id", async () => {
    const ctx = await build();
    const id = await openDraftInReadingPane(ctx);
    await ctx.vm.openDraftForEdit(id);
    expect(ctx.vm.getState().composer).toMatchObject({
      mode: "editDraft", draftId: id,
      to: [{ email: "a@x.com" }], cc: [{ email: "c@x.com" }], bcc: [{ email: "b@x.com" }],
      subject: "Draft subject", bodyHtml: "<p>draft body</p>",
    });
  });

  it("openDraftForEdit sets a notice and opens no composer when the body load fails", async () => {
    const ctx = await build();
    const id = await openDraftInReadingPane(ctx);
    ctx.provider.getMessageBody = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(ctx.vm.openDraftForEdit(id)).resolves.toBeUndefined();
    expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringMatching(/couldn't load/i));
    expect(ctx.vm.getState().composer).toBeNull();
  });

  it("send after openDraftForEdit keeps the draft's recipients and subject instead of blanking them", async () => {
    const ctx = await build();
    const id = await openDraftInReadingPane(ctx);
    const update = vi.spyOn(ctx.provider, "updateDraft");
    await ctx.vm.openDraftForEdit(id);
    await ctx.vm.send();
    expect(update).toHaveBeenCalledWith(id, {
      to: [{ email: "a@x.com" }], cc: [{ email: "c@x.com" }], bcc: [{ email: "b@x.com" }],
      subject: "Draft subject", bodyHtml: "<p>draft body</p>",
    });
    expect(ctx.provider.sentLog).toContainEqual({ kind: "draft", draftId: id });
  });
});

describe("ViewModel — delete/archive", () => {
  it("deleteMessage removes the message from the list and closes an open thread showing it", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    ctx.provider.addMessage(sum("m1", "t1", 1));
    await ctx.vm.init();
    await ctx.vm.openThread("t1");
    expect(ctx.vm.getState().openThreadId).toBe("t1");

    await ctx.vm.deleteMessage("m1");

    expect(ctx.vm.getState().threads).toEqual([]);
    expect(ctx.vm.getState().openThreadId).toBeNull();
  });

  it("archiveMessage removes the message from the current list without closing an unrelated open thread", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1), sum("m2", "t2", 2)]);
    ctx.provider.addMessage(sum("m1", "t1", 1));
    ctx.provider.addMessage(sum("m2", "t2", 2));
    await ctx.vm.init();
    await ctx.vm.openThread("t2");

    await ctx.vm.archiveMessage("m1");

    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2"]);
    expect(ctx.vm.getState().openThreadId).toBe("t2");
  });

  it("deleteMessage sets a notice on provider failure and leaves the list unchanged", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    ctx.provider.addMessage(sum("m1", "t1", 1));
    await ctx.vm.init();
    vi.spyOn(ctx.provider, "deleteMessage").mockRejectedValue(new Error("network down"));

    await ctx.vm.deleteMessage("m1");

    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
    expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringContaining("network down"));
  });

  it("deleteThread deletes every message in the conversation, concurrently, and closes the thread if open", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1), sum("m2", "t1", 2), sum("m3", "t2", 3)]);
    ctx.provider.addMessage(sum("m1", "t1", 1));
    ctx.provider.addMessage(sum("m2", "t1", 2));
    ctx.provider.addMessage(sum("m3", "t2", 3));
    await ctx.vm.init();
    await ctx.vm.openThread("t1");
    const spy = vi.spyOn(ctx.provider, "deleteMessage");

    await ctx.vm.deleteThread("t1");

    expect(spy).toHaveBeenCalledWith("m1");
    expect(spy).toHaveBeenCalledWith("m2");
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2"]);
    expect(ctx.vm.getState().openThreadId).toBeNull();
  });

  it("moveThread moves every message in the conversation to the destination mailbox", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1), sum("m2", "t1", 2), sum("m3", "t2", 3)]);
    ctx.provider.addMessage(sum("m1", "t1", 1));
    ctx.provider.addMessage(sum("m2", "t1", 2));
    ctx.provider.addMessage(sum("m3", "t2", 3));
    await ctx.vm.init();
    await ctx.vm.openThread("t1");
    const spy = vi.spyOn(ctx.provider, "moveMessage");

    await ctx.vm.moveThread("t1", "PROJ");

    expect(spy).toHaveBeenCalledWith("m1", "PROJ");
    expect(spy).toHaveBeenCalledWith("m2", "PROJ");
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2"]);
    expect(ctx.vm.getState().openThreadId).toBeNull();
  });

  it("archiveThread reports partial failure without discarding what succeeded", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1), sum("m2", "t1", 2)]);
    ctx.provider.addMessage(sum("m1", "t1", 1));
    ctx.provider.addMessage(sum("m2", "t1", 2));
    await ctx.vm.init();
    vi.spyOn(ctx.provider, "archiveMessage").mockImplementation(async (id: string) => {
      if (id === "m2") throw new Error("boom");
    });

    await ctx.vm.archiveThread("t1");

    // m1 succeeded and was removed from cache; m2 failed and stays in INBOX,
    // so `groupThreads` still surfaces "t1" — just with only m2 left in it.
    // The thread does NOT fully disappear from the current mailbox's list,
    // and the partial failure is reported, not silently swallowed.
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
    expect(ctx.vm.getState().threads[0].messages.map((m) => m.id)).toEqual(["m2"]);
    expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringMatching(/1 of 2/));
  });

  it("deleteThread sets a notice when the cache read fails instead of rejecting", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    ctx.provider.addMessage(sum("m1", "t1", 1));
    await ctx.vm.init();
    vi.spyOn(ctx.cache, "getThreadMessages").mockRejectedValue(new Error("db is closed"));

    await ctx.vm.deleteThread("t1");

    expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringContaining("db is closed"));
  });

  it("archiveThread reports a thread with no cached messages instead of silently doing nothing", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    ctx.provider.addMessage(sum("m1", "t1", 1));
    await ctx.vm.init();
    const spy = vi.spyOn(ctx.provider, "archiveMessage");

    // A search hit whose thread was never cached: nothing to act on.
    await ctx.vm.archiveThread("t-never-cached");

    expect(spy).not.toHaveBeenCalled();
    expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringMatching(/couldn't find any messages/i));
  });
});

describe("ViewModel — delete/archive during an active search", () => {
  it("deleteMessage leaves the search results in place instead of repainting the mailbox list", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1), sum("m2", "t2", 2)]);
    ctx.provider.addMessage(sum("m1", "t1", 1));
    ctx.provider.addMessage(sum("m2", "t2", 2));
    ctx.provider.setSearchResults("report", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    await ctx.vm.runSearch("report");
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);

    await ctx.vm.deleteMessage("m1");

    // Without the search guard, `reloadList()` would repaint the INBOX listing
    // (["t2"]) underneath the still-visible search box and query.
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
    expect(ctx.vm.getState().search).toEqual({ query: "report", active: true });
  });

  it("archiveThread leaves the search results in place instead of repainting the mailbox list", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1), sum("m2", "t2", 2)]);
    ctx.provider.addMessage(sum("m1", "t1", 1));
    ctx.provider.addMessage(sum("m2", "t2", 2));
    ctx.provider.setSearchResults("report", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    await ctx.vm.runSearch("report");

    await ctx.vm.archiveThread("t1");

    // The provider call still happened and the cache row is gone; only the
    // visible search listing is left alone until the user re-searches.
    expect(await ctx.cache.getThreadMessages("a1", "t1")).toEqual([]);
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
    expect(ctx.vm.getState().search).toEqual({ query: "report", active: true });
  });
});

describe("ViewModel — saveMessageToVault", () => {
  it("hands the host a Markdown note built from the open message's summary and body", async () => {
    const saveNote = vi.fn();
    const ctx = await build();
    const vm = new ViewModel({
      ...contactDeps(() => ctx.provider),
      cache: ctx.cache, sync: ctx.sync, settings: ctx.settings, getProvider: () => ctx.provider,
      isOnline: () => true, openExternal: () => {}, saveBlob: async () => {}, saveNote,
      promptFolderName: () => {}, promptFolderRename: () => {}, pickNoteAttachment: async () => undefined, showNotice: vi.fn(),
    });
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await vm.init();
    await ctx.cache.upsertMessages("a1", [{
      id: "m1", threadId: "t1", mailboxIds: ["INBOX"],
      from: { name: "Jane", email: "j@x.com" }, to: [{ email: "me@x.com" }], cc: [],
      subject: "Hello", snippet: "hi", date: Date.parse("2026-01-02T03:04:05Z"),
      unread: false, hasAttachments: false, flagged: false,
    }]);
    ctx.provider.getMessageBody = vi.fn().mockResolvedValue({
      id: "m1", html: "<p><b>Hi</b> there</p>", text: null, attachments: [], headers: {},
    });
    await vm.openThread("t1");

    await vm.saveMessageToVault("m1");

    expect(saveNote).toHaveBeenCalledOnce();
    const [path, content] = saveNote.mock.calls[0];
    expect(path).toBe("2026-01-02 Hello.md");
    expect(content).toContain('sender: "Jane <j@x.com>"');
    expect(content).toContain('subject: "Hello"');
    expect(content).toContain("**Hi** there");
  });

  it("sets a notice instead of saving when the body never loaded and isn't cached", async () => {
    const saveNote = vi.fn();
    const showNotice = vi.fn();
    const ctx = await build();
    const vm = new ViewModel({
      ...contactDeps(() => ctx.provider),
      cache: ctx.cache, sync: ctx.sync, settings: ctx.settings, getProvider: () => ctx.provider,
      isOnline: () => true, openExternal: () => {}, saveBlob: async () => {}, saveNote,
      promptFolderName: () => {}, promptFolderRename: () => {}, pickNoteAttachment: async () => undefined, showNotice,
    });
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await vm.init();
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    ctx.provider.getMessageBody = vi.fn().mockRejectedValue(new Error("network"));
    await vm.openThread("t1");

    await vm.saveMessageToVault("m1");

    expect(saveNote).not.toHaveBeenCalled();
    expect(showNotice).toHaveBeenCalledWith(expect.stringMatching(/still loading/i));
  });

  it("does nothing for a message id that isn't currently open", async () => {
    const saveNote = vi.fn();
    const ctx = await build();
    const vm = new ViewModel({
      ...contactDeps(() => ctx.provider),
      cache: ctx.cache, sync: ctx.sync, settings: ctx.settings, getProvider: () => ctx.provider,
      isOnline: () => true, openExternal: () => {}, saveBlob: async () => {}, saveNote,
      promptFolderName: () => {}, promptFolderRename: () => {}, pickNoteAttachment: async () => undefined, showNotice: vi.fn(),
    });
    await vm.saveMessageToVault("does-not-exist");
    expect(saveNote).not.toHaveBeenCalled();
  });
});

describe("ViewModel — folder sync", () => {
  it("picks up a folder created elsewhere without switching accounts", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.vm.init();
    expect(ctx.vm.getState().mailboxes.map((m) => m.id).sort()).toEqual(["INBOX", "SENT"]);

    await ctx.sync.syncAccount("a1"); // backfill
    ctx.provider.addMailbox({ id: "PROJ", name: "Project X", kind: "custom" });
    await ctx.sync.syncAccount("a1"); // incremental — discovers PROJ
    // The changes-emitter's listener calls refreshMailboxes fire-and-forget
    // (`void this.refreshMailboxes(...)`), and it reads through fake-indexeddb
    // (not a plain Promise chain), so syncAccount resolving doesn't guarantee
    // it's finished — poll instead of guessing a microtask-tick count.
    await vi.waitFor(() => {
      expect(ctx.vm.getState().mailboxes.map((m) => m.id).sort()).toEqual(["INBOX", "PROJ", "SENT"]);
    });
  });

  it("falls back to Inbox when the active mailbox is deleted elsewhere", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.vm.init();
    await ctx.sync.syncAccount("a1"); // backfill
    await ctx.vm.selectMailbox("SENT");
    expect(ctx.vm.getState().activeMailboxId).toBe("SENT");

    ctx.provider.removeMailbox("SENT");
    await ctx.sync.syncAccount("a1"); // incremental — SENT is gone
    await vi.waitFor(() => {
      expect(ctx.vm.getState().activeMailboxId).toBe("INBOX");
    });
    expect(ctx.vm.getState().mailboxes.map((m) => m.id)).toEqual(["INBOX"]);
  });

  it("preserves an active search instead of clearing it when the active mailbox is deleted elsewhere", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.vm.init();
    await ctx.sync.syncAccount("a1"); // backfill
    await ctx.vm.selectMailbox("SENT");
    ctx.provider.setSearchResults("report", []);
    await ctx.vm.runSearch("report");
    expect(ctx.vm.getState().search).toEqual({ query: "report", active: true });

    ctx.provider.removeMailbox("SENT");
    await ctx.sync.syncAccount("a1"); // incremental — SENT is gone
    await vi.waitFor(() => {
      expect(ctx.vm.getState().activeMailboxId).toBe("INBOX");
    });
    // A background mailbox deletion isn't a user-initiated switch — the
    // search the user is looking at must survive it.
    expect(ctx.vm.getState().search).toEqual({ query: "report", active: true });
  });
});

describe("ViewModel — requestCreateMailbox", () => {
  it("prompts for a name, creates the folder via the provider, and switches to it", async () => {
    const ctx = await build();
    let submit: ((name: string) => void) | undefined;
    const vm = new ViewModel({
      ...contactDeps(() => ctx.provider),
      cache: ctx.cache, sync: ctx.sync, settings: ctx.settings, getProvider: () => ctx.provider,
      isOnline: () => true, openExternal: () => {}, saveBlob: async () => {}, saveNote: () => {},
      promptFolderName: (onSubmit) => { submit = onSubmit; }, promptFolderRename: () => {}, pickNoteAttachment: async () => undefined, showNotice: vi.fn(),
    });
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await vm.init();

    vm.requestCreateMailbox();
    expect(submit).toBeTypeOf("function");
    submit!("Project X");
    await vi.waitFor(() => {
      expect(vm.getState().mailboxes.map((m) => m.name)).toContain("Project X");
    });

    const created = vm.getState().mailboxes.find((m) => m.name === "Project X")!;
    expect(created.kind).toBe("custom");
    expect(vm.getState().activeMailboxId).toBe(created.id);
    expect((await ctx.cache.getMailboxes("a1")).map((m) => m.name)).toContain("Project X");
  });

  it("sets a notice instead of creating the folder when the provider call fails", async () => {
    const ctx = await build();
    let submit: ((name: string) => void) | undefined;
    const showNotice = vi.fn();
    const vm = new ViewModel({
      ...contactDeps(() => ctx.provider),
      cache: ctx.cache, sync: ctx.sync, settings: ctx.settings, getProvider: () => ctx.provider,
      isOnline: () => true, openExternal: () => {}, saveBlob: async () => {}, saveNote: () => {},
      promptFolderName: (onSubmit) => { submit = onSubmit; }, promptFolderRename: () => {}, pickNoteAttachment: async () => undefined, showNotice,
    });
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await vm.init();
    vi.spyOn(ctx.provider, "createMailbox").mockRejectedValue(new Error("network down"));

    vm.requestCreateMailbox();
    submit!("Project X");
    await vi.waitFor(() => {
      expect(showNotice).toHaveBeenCalled();
    });
    expect(vm.getState().mailboxes.map((m) => m.name)).not.toContain("Project X");
  });
});

describe("ViewModel — renameMailbox", () => {
  it("renames the folder via the provider and updates cache and state", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    ctx.provider.addMailbox({ id: "PROJ", name: "Project X", kind: "custom" });
    await ctx.cache.putMailboxes("a1", [{ id: "PROJ", name: "Project X", kind: "custom" }]);
    await ctx.vm.init();

    await ctx.vm.renameMailbox("PROJ", "Project Y");

    expect(ctx.vm.getState().mailboxes.find((m) => m.id === "PROJ")?.name).toBe("Project Y");
    expect((await ctx.cache.getMailboxes("a1")).find((m) => m.id === "PROJ")?.name).toBe("Project Y");
  });

  it("sets a notice instead of renaming when the provider call fails", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    ctx.provider.addMailbox({ id: "PROJ", name: "Project X", kind: "custom" });
    await ctx.cache.putMailboxes("a1", [{ id: "PROJ", name: "Project X", kind: "custom" }]);
    await ctx.vm.init();
    vi.spyOn(ctx.provider, "renameMailbox").mockRejectedValue(new Error("network down"));

    await ctx.vm.renameMailbox("PROJ", "Project Y");

    expect(ctx.showNotice).toHaveBeenCalled();
    expect(ctx.vm.getState().mailboxes.find((m) => m.id === "PROJ")?.name).toBe("Project X");
  });
});

describe("ViewModel — deleteMailbox", () => {
  it("deletes the folder via the provider and cleans up its cached messages", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    ctx.provider.addMailbox({ id: "PROJ", name: "Project X", kind: "custom" });
    await ctx.cache.putMailboxes("a1", [{ id: "PROJ", name: "Project X", kind: "custom" }]);
    await ctx.cache.upsertMessages("a1", [{
      id: "p1", threadId: "tp1", mailboxIds: ["PROJ"], from: { email: "s@x.com" }, to: [], cc: [],
      subject: "s", snippet: "", date: 1, unread: true, hasAttachments: false, flagged: false,
    }]);
    await ctx.vm.init();

    await ctx.vm.deleteMailbox("PROJ");

    expect(ctx.vm.getState().mailboxes.map((m) => m.id)).not.toContain("PROJ");
    expect(await ctx.cache.getMailboxes("a1")).not.toContainEqual(expect.objectContaining({ id: "PROJ" }));
    expect(await ctx.cache.listMailboxMessages("a1", "PROJ")).toHaveLength(0);
  });

  it("falls back to Inbox when the deleted folder was the active mailbox", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    ctx.provider.addMailbox({ id: "PROJ", name: "Project X", kind: "custom" });
    await ctx.cache.putMailboxes("a1", [{ id: "PROJ", name: "Project X", kind: "custom" }]);
    await ctx.vm.init();
    await ctx.vm.selectMailbox("PROJ");

    await ctx.vm.deleteMailbox("PROJ");

    expect(ctx.vm.getState().activeMailboxId).toBe("INBOX");
  });

  it("sets a notice instead of deleting when the provider call fails", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    ctx.provider.addMailbox({ id: "PROJ", name: "Project X", kind: "custom" });
    await ctx.cache.putMailboxes("a1", [{ id: "PROJ", name: "Project X", kind: "custom" }]);
    await ctx.vm.init();
    vi.spyOn(ctx.provider, "deleteMailbox").mockRejectedValue(new Error("network down"));

    await ctx.vm.deleteMailbox("PROJ");

    expect(ctx.showNotice).toHaveBeenCalled();
    expect(ctx.vm.getState().mailboxes.map((m) => m.id)).toContain("PROJ");
  });

  it("shows a friendly notice when Graph rejects deleting one of its own protected folders", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    ctx.provider.addMailbox({ id: "SNOOZED", name: "Snoozed", kind: "custom" });
    await ctx.cache.putMailboxes("a1", [{ id: "SNOOZED", name: "Snoozed", kind: "custom" }]);
    await ctx.vm.init();
    vi.spyOn(ctx.provider, "deleteMailbox").mockRejectedValue(
      new Error("Graph 400: Distinguished folders cannot be deleted."),
    );

    await ctx.vm.deleteMailbox("SNOOZED");

    expect(ctx.showNotice).toHaveBeenCalledWith("This is a built-in Outlook folder and can't be deleted.");
    expect(ctx.vm.getState().mailboxes.map((m) => m.id)).toContain("SNOOZED");
  });
});

describe("ViewModel — ribbon prefs", () => {
  it("mirrors ribbon prefs into state on selectAccount", async () => {
    const ctx = await build();
    await ctx.settings.updatePrefs({ ribbonEnabled: false, ribbonCollapsedByDefault: true });
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.vm.init();
    expect(ctx.vm.getState().ribbonEnabled).toBe(false);
    expect(ctx.vm.getState().ribbonCollapsedByDefault).toBe(true);
  });

  it("defaults to ribbon enabled and expanded before any account is selected", async () => {
    const ctx = await build();
    expect(ctx.vm.getState().ribbonEnabled).toBe(true);
    expect(ctx.vm.getState().ribbonCollapsedByDefault).toBe(false);
  });
});

describe("ViewModel — requestRenameMailbox", () => {
  it("prompts with the folder's current name and renames on submit", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    ctx.provider.addMailbox({ id: "PROJ", name: "Project X", kind: "custom" });
    await ctx.cache.putMailboxes("a1", [{ id: "PROJ", name: "Project X", kind: "custom" }]);
    await ctx.vm.init();

    ctx.vm.requestRenameMailbox("PROJ");
    expect(ctx.promptFolderRename).toHaveBeenCalledWith("Project X", expect.any(Function));
    ctx.promptFolderRename.mock.calls[0][1]("Project Y");
    await vi.waitFor(() => {
      expect(ctx.vm.getState().mailboxes.find((m) => m.id === "PROJ")?.name).toBe("Project Y");
    });
  });

  it("does nothing for an unknown mailbox id", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.requestRenameMailbox("nope");
    expect(ctx.promptFolderRename).not.toHaveBeenCalled();
  });
});

describe("ViewModel — attach a note to the open composer", () => {
  const att = { filename: "n.md", mimeType: "text/markdown", contentBytes: "aGk=" };

  it("addComposerAttachment appends to the open composer", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.addComposerAttachment(att);
    expect(ctx.vm.getState().composer?.attachments).toEqual([att]);
  });

  it("addComposerAttachment is a no-op with no composer open", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.addComposerAttachment(att);
    expect(ctx.vm.getState().composer).toBeNull();
  });

  it("requestAttachNote attaches whatever the host picker resolves with", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.pickNoteAttachment.mockResolvedValue(att);
    await ctx.vm.requestAttachNote();
    expect(ctx.vm.getState().composer?.attachments).toEqual([att]);
  });

  it("requestAttachNote leaves the composer alone when the picker yields nothing", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.pickNoteAttachment.mockResolvedValue(undefined);
    await ctx.vm.requestAttachNote();
    expect(ctx.vm.getState().composer?.attachments).toEqual([]);
  });
});
