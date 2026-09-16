import { describe, it, expect, vi, beforeEach } from "vitest";
import { ViewModel } from "../../src/view/view-model";
import { MailCache } from "../../src/cache/mail-cache";
import { CursorStore } from "../../src/cache/cursor-store";
import { SyncEngine } from "../../src/sync/sync-engine";
import { SettingsStore } from "../../src/settings/settings-store";
import { FakeProvider } from "../../src/providers/fake-provider";
import { Logger } from "../../src/util/logger";
import { AuthError } from "../../src/providers/types";
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
    openExternal: () => {}, saveBlob: async () => {}, saveNote: () => {},
  });
  return { cache, provider, sync, settings, vm };
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
      openExternal: () => {}, saveBlob: async () => {}, saveNote: () => {},
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
      to: [], cc: [], bcc: [], subject: "", sending: false, error: null, bodyHtml: "",
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
      to: [], cc: [], bcc: [], subject: "", sending: false, error: null, bodyHtml: "",
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
    expect(ctx.vm.getState().notice).toMatch(/sent/i);
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
    expect(ctx.vm.getState().notice).toMatch(/couldn't load/i);
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
    expect(ctx.vm.getState().notice).toContain("network down");
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
    expect(ctx.vm.getState().notice).toMatch(/1 of 2/);
  });

  it("deleteThread sets a notice when the cache read fails instead of rejecting", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    ctx.provider.addMessage(sum("m1", "t1", 1));
    await ctx.vm.init();
    vi.spyOn(ctx.cache, "getThreadMessages").mockRejectedValue(new Error("db is closed"));

    await ctx.vm.deleteThread("t1");

    expect(ctx.vm.getState().notice).toContain("db is closed");
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
    expect(ctx.vm.getState().notice).toMatch(/couldn't find any messages/i);
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
      cache: ctx.cache, sync: ctx.sync, settings: ctx.settings, getProvider: () => ctx.provider,
      isOnline: () => true, openExternal: () => {}, saveBlob: async () => {}, saveNote,
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
    const ctx = await build();
    const vm = new ViewModel({
      cache: ctx.cache, sync: ctx.sync, settings: ctx.settings, getProvider: () => ctx.provider,
      isOnline: () => true, openExternal: () => {}, saveBlob: async () => {}, saveNote,
    });
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await vm.init();
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    ctx.provider.getMessageBody = vi.fn().mockRejectedValue(new Error("network"));
    await vm.openThread("t1");

    await vm.saveMessageToVault("m1");

    expect(saveNote).not.toHaveBeenCalled();
    expect(vm.getState().notice).toMatch(/still loading/i);
  });

  it("does nothing for a message id that isn't currently open", async () => {
    const saveNote = vi.fn();
    const ctx = await build();
    const vm = new ViewModel({
      cache: ctx.cache, sync: ctx.sync, settings: ctx.settings, getProvider: () => ctx.provider,
      isOnline: () => true, openExternal: () => {}, saveBlob: async () => {}, saveNote,
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
