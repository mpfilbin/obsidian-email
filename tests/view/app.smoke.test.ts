import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import App from "../../src/view/App.svelte";
import type { ViewModel, ViewState } from "../../src/view/view-model";

function fakeVm(state: Partial<ViewState> = {}): ViewModel {
  let full: ViewState = {
    accounts: [{ id: "a1", email: "a1@x.com", provider: "ms-graph", status: "idle" }],
    activeAccountId: "a1",
    mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }],
    activeMailboxId: "INBOX",
    threads: [{
      threadId: "t1", subject: "Hello", lastDate: 1, unread: true,
      messages: [{
        id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
        to: [], cc: [], subject: "Hello", snippet: "hi there", date: 1,
        unread: true, hasAttachments: false, flagged: false,
      }],
    }],
    hasMore: false, loadingList: false, autoLoadImages: false,
    search: { query: "", active: false },
    openThreadId: null, openMessages: [], notice: null,
    composer: null,
    ...state,
  };
  // A minimal reactive store so the default (un-overridden) `openNewMessage`
  // can actually flip `composer` on and notify subscribers, matching real
  // ViewModel behavior closely enough for the "New message opens the
  // composer" smoke test — every other mutating method here stays a bare
  // vi.fn() per-test override, exactly as the rest of this fixture does.
  // `set` rebinds `full` to a NEW object (mirroring the real ViewModel's
  // own `set`) rather than mutating in place, since App.svelte's `state`
  // reassignment needs a referentially-new value to be picked up.
  const listeners = new Set<(s: ViewState) => void>();
  const set = (patch: Partial<ViewState>) => {
    full = { ...full, ...patch };
    for (const fn of [...listeners]) fn(full);
  };
  return {
    getState: () => full,
    subscribe: (fn: (s: ViewState) => void) => { listeners.add(fn); fn(full); return () => listeners.delete(fn); },
    selectAccount: vi.fn(), selectMailbox: vi.fn(), openThread: vi.fn(), closeThread: vi.fn(),
    loadMore: vi.fn(), refresh: vi.fn(), runSearch: vi.fn(), clearSearch: vi.fn(),
    renderDeps: () => ({ getInlineAttachment: async () => undefined, openExternal: () => {} }),
    downloadAttachment: vi.fn(), downloadAttachmentToDisk: vi.fn(),
    openReply: vi.fn(), openForward: vi.fn(),
    openNewMessage: vi.fn(() => {
      set({ composer: { mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "", sending: false, error: null, savedSnapshot: null } });
    }),
    openDraftForEdit: vi.fn(), updateComposerFields: vi.fn(), updateComposerBody: vi.fn(),
    hasUnsavedComposerContent: vi.fn().mockReturnValue(false),
    send: vi.fn(), saveDraft: vi.fn(), discardDraft: vi.fn(), closeComposer: vi.fn(),
    deleteMessage: vi.fn(), archiveMessage: vi.fn(), deleteThread: vi.fn(), archiveThread: vi.fn(),
    // Test-only escape hatch, so an overridden method can push state the way
    // the real ViewModel would (e.g. a saveDraft that sets composer.error).
    __setState: set,
  } as unknown as ViewModel;
}

/** The fixture's test-only state setter (see `__setState` above). */
const setStateOf = (vm: ViewModel) =>
  (vm as unknown as { __setState: (patch: Partial<ViewState>) => void }).__setState;

describe("App.svelte smoke", () => {
  it("renders account, mailbox and thread rows", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm: fakeVm(), onAddAccount: () => {} } });
    expect(host.textContent).toContain("Inbox");
    expect(host.textContent).toContain("Hello");
    expect(host.textContent).toContain("Jane");
    unmount(app);
  });

  it("shows the notice bar when set", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm: fakeVm({ notice: "Offline" }), onAddAccount: () => {} } });
    expect(host.textContent).toContain("Offline");
    unmount(app);
  });

  it("shows a syncing indicator on the active account and the refresh button while syncing", () => {
    const host = document.createElement("div");
    const app = mount(App, {
      target: host,
      props: {
        vm: fakeVm({ accounts: [{ id: "a1", email: "a1@x.com", provider: "ms-graph", status: "syncing" }] }),
        onAddAccount: () => {},
      },
    });
    expect(host.querySelector(".oe-syncing-ring")).not.toBeNull();
    expect(host.querySelector(".oe-refresh.is-syncing")).not.toBeNull();
    unmount(app);
  });

  it("shows neither syncing indicator when idle", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm: fakeVm(), onAddAccount: () => {} } });
    expect(host.querySelector(".oe-syncing-ring")).toBeNull();
    expect(host.querySelector(".oe-refresh.is-syncing")).toBeNull();
    unmount(app);
  });

  it("renders two resizers and a reading pane by default", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm: fakeVm(), onAddAccount: () => {} } });
    expect(host.querySelectorAll('[role="separator"]')).toHaveLength(2);
    expect(host.querySelector(".oe-reading-pane")).not.toBeNull();
    unmount(app);
  });

  it("collapses and re-expands the reading pane via the toolbar toggle", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm: fakeVm(), onAddAccount: () => {} } });
    const toggle = host.querySelector<HTMLButtonElement>(".oe-toggle-reading")!;

    toggle.click();
    flushSync();
    expect(host.querySelector(".oe-reading-pane")).toBeNull();
    expect(host.querySelectorAll('[role="separator"]')).toHaveLength(1);

    toggle.click();
    flushSync();
    expect(host.querySelector(".oe-reading-pane")).not.toBeNull();
    expect(host.querySelectorAll('[role="separator"]')).toHaveLength(2);
    unmount(app);
  });

  it("clicking New message opens the new-message composer", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm: fakeVm(), onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>(".oe-new-message")!.click();
    flushSync();
    expect(host.querySelector(".oe-composer")).not.toBeNull();
    unmount(app);
  });

  it("widens the mailbox column when its resizer is dragged", () => {
    localStorage.clear();
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm: fakeVm(), onAddAccount: () => {} } });
    const grid = host.querySelector<HTMLElement>(".oe-grid")!;
    const resizer = host.querySelectorAll('[role="separator"]')[0] as HTMLElement;
    const widthBefore = grid.style.gridTemplateColumns;

    resizer.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 100, bubbles: true }));
    resizer.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 160, bubbles: true }));
    resizer.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
    flushSync();

    expect(grid.style.gridTemplateColumns).not.toBe(widthBefore);
    expect(grid.style.gridTemplateColumns).toContain("260px"); // 200 default + 60px drag
    unmount(app);
  });
});

describe("App.svelte — composer wiring", () => {
  it("New message calls vm.openNewMessage when nothing is unsaved", () => {
    const openNewMessage = vi.fn();
    const vm = fakeVm();
    (vm as unknown as { openNewMessage: typeof openNewMessage }).openNewMessage = openNewMessage;
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>(".oe-new-message")!.click();
    expect(openNewMessage).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("switching composers with unsaved content shows a save/discard/cancel prompt instead of switching immediately", () => {
    const openNewMessage = vi.fn();
    const vm = fakeVm({ composer: {
      mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", sending: false, error: null, savedSnapshot: null,
    } });
    (vm as unknown as { openNewMessage: typeof openNewMessage; hasUnsavedComposerContent: () => boolean }).openNewMessage = openNewMessage;
    (vm as unknown as { hasUnsavedComposerContent: () => boolean }).hasUnsavedComposerContent = () => true;
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>(".oe-new-message")!.click();
    flushSync();
    expect(openNewMessage).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();
    unmount(app);
  });

  it("prompt's Discard calls vm.discardDraft then proceeds with the pending switch", async () => {
    const discardDraft = vi.fn().mockResolvedValue(undefined);
    const openNewMessage = vi.fn();
    const vm = fakeVm({ composer: {
      mode: "reply", targetMessageId: "m1", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", sending: false, error: null, savedSnapshot: null,
    } });
    Object.assign(vm, { discardDraft, openNewMessage, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>(".oe-new-message")!.click();
    flushSync();
    host.querySelector<HTMLElement>(".oe-composer-prompt-discard")!.click();
    // Two microtask ticks to drain the async handler's `await vm.discardDraft()`
    // continuation — matching the existing pattern in
    // tests/render/message-renderer.test.ts for flushing an awaited mock.
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(discardDraft).toHaveBeenCalledOnce();
    expect(openNewMessage).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("prompt's Save draft does not switch when the save fails, leaving the error visible", async () => {
    const openNewMessage = vi.fn();
    const vm = fakeVm({ composer: {
      mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", sending: false, error: null, savedSnapshot: null,
    } });
    // saveDraft swallows its own errors and reports them through
    // composer.error rather than throwing, exactly as the ViewModel does.
    const saveDraft = vi.fn(async () => {
      setStateOf(vm)({ composer: { ...vm.getState().composer!, error: "network down" } });
    });
    Object.assign(vm, { saveDraft, openNewMessage, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>(".oe-new-message")!.click();
    flushSync();
    host.querySelector<HTMLElement>(".oe-composer-prompt-save")!.click();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(saveDraft).toHaveBeenCalledOnce();
    expect(openNewMessage).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();
    expect(host.querySelector(".oe-composer-error")?.textContent).toContain("network down");
    unmount(app);
  });

  it("prompt's Save draft proceeds with the switch once the save succeeds", async () => {
    const openNewMessage = vi.fn();
    const vm = fakeVm({ composer: {
      mode: "editDraft", draftId: "d1", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", sending: false, error: null, savedSnapshot: null,
    } });
    const saveDraft = vi.fn().mockResolvedValue(undefined);
    Object.assign(vm, { saveDraft, openNewMessage, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>(".oe-new-message")!.click();
    flushSync();
    host.querySelector<HTMLElement>(".oe-composer-prompt-save")!.click();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(openNewMessage).toHaveBeenCalledOnce();
    expect(host.querySelector(".oe-composer-prompt")).toBeNull();
    unmount(app);
  });

  it("prompt's Cancel leaves the current composer open and does not switch", () => {
    const openNewMessage = vi.fn();
    const vm = fakeVm({ composer: {
      mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", sending: false, error: null, savedSnapshot: null,
    } });
    Object.assign(vm, { openNewMessage, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>(".oe-new-message")!.click();
    flushSync();
    host.querySelector<HTMLElement>(".oe-composer-prompt-cancel")!.click();
    flushSync();
    expect(openNewMessage).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).toBeNull();
    unmount(app);
  });

  it("opening a thread with an unmodified composer open goes straight through", () => {
    const openThread = vi.fn();
    const vm = fakeVm({ composer: {
      mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "", sending: false, error: null, savedSnapshot: null,
    } });
    Object.assign(vm, { openThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>(".oe-thread-row")!.click();
    flushSync();
    // The ViewModel drops the (empty) composer itself, so no prompt and no
    // orphaned composer hiding the thread that just opened.
    expect(openThread).toHaveBeenCalledWith("t1");
    expect(host.querySelector(".oe-composer-prompt")).toBeNull();
    unmount(app);
  });

  it("selecting a mailbox with an unmodified composer open goes straight through", () => {
    const selectMailbox = vi.fn();
    const vm = fakeVm({
      mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }, { id: "SENT", name: "Sent", kind: "sent" }],
      composer: { mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "", sending: false, error: null, savedSnapshot: null },
    });
    Object.assign(vm, { selectMailbox });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelectorAll<HTMLElement>(".oe-mailbox")[1].click();
    flushSync();
    expect(selectMailbox).toHaveBeenCalledWith("SENT");
    expect(host.querySelector(".oe-composer-prompt")).toBeNull();
    unmount(app);
  });

  it("navigating away with unsaved composer content prompts instead of discarding it", () => {
    const selectMailbox = vi.fn();
    const openThread = vi.fn();
    const vm = fakeVm({
      mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }, { id: "SENT", name: "Sent", kind: "sent" }],
      composer: { mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", sending: false, error: null, savedSnapshot: null },
    });
    Object.assign(vm, { selectMailbox, openThread, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelectorAll<HTMLElement>(".oe-mailbox")[1].click();
    flushSync();
    expect(selectMailbox).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();

    host.querySelector<HTMLElement>(".oe-composer-prompt-cancel")!.click();
    flushSync();
    host.querySelector<HTMLElement>(".oe-thread-row")!.click();
    flushSync();
    expect(openThread).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();
    unmount(app);
  });

  it("passes isDraftsMailbox=true to ReadingPane when the active mailbox kind is drafts", () => {
    // fakeVm's base fixture has an "m1" message but leaves openMessages empty
    // by default (no thread auto-opened); open it explicitly here so a
    // MessageBlock actually renders for the isDraftsMailbox assertion below.
    const vm = fakeVm({
      mailboxes: [{ id: "DRAFTS", name: "Drafts", kind: "drafts" }],
      activeMailboxId: "DRAFTS",
      openThreadId: "t1",
      openMessages: [{ summary: {
        id: "m1", threadId: "t1", mailboxIds: ["DRAFTS"], from: { name: "Jane", email: "j@x.com" },
        to: [], cc: [], subject: "Hello", snippet: "hi there", date: 1,
        unread: true, hasAttachments: false, flagged: false,
      } }],
    });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    expect(host.querySelector('[data-action="edit-draft"]')).not.toBeNull();
    expect(host.querySelector('[data-action="reply"]')).toBeNull();
    unmount(app);
  });
});

describe("App.svelte — delete/archive wiring", () => {
  it("clicking Archive on a thread row calls vm.archiveThread", () => {
    const archiveThread = vi.fn();
    const vm = fakeVm();
    Object.assign(vm, { archiveThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="archive"]')!.click();
    expect(archiveThread).toHaveBeenCalledWith("t1");
    unmount(app);
  });

  it("clicking Delete on a thread row in a normal mailbox calls vm.deleteThread immediately, no prompt", () => {
    const deleteThread = vi.fn();
    const vm = fakeVm();
    Object.assign(vm, { deleteThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="delete"]')!.click();
    expect(deleteThread).toHaveBeenCalledWith("t1");
    expect(host.querySelector(".oe-delete-confirm")).toBeNull();
    unmount(app);
  });

  it("clicking Delete on a thread row in the Trash mailbox shows a confirm prompt instead of deleting immediately", () => {
    const deleteThread = vi.fn();
    const vm = fakeVm({ mailboxes: [{ id: "TRASH", name: "Deleted Items", kind: "trash" }], activeMailboxId: "TRASH" });
    Object.assign(vm, { deleteThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="delete"]')!.click();
    flushSync();
    expect(deleteThread).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-delete-confirm")).not.toBeNull();

    host.querySelector<HTMLElement>(".oe-delete-confirm")!.click();
    expect(deleteThread).toHaveBeenCalledWith("t1");
    unmount(app);
  });

  it("canceling the delete-confirm prompt does not call vm.deleteThread", () => {
    const deleteThread = vi.fn();
    const vm = fakeVm({ mailboxes: [{ id: "TRASH", name: "Deleted Items", kind: "trash" }], activeMailboxId: "TRASH" });
    Object.assign(vm, { deleteThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="delete"]')!.click();
    flushSync();
    host.querySelector<HTMLElement>(".oe-delete-cancel")!.click();
    flushSync();
    expect(deleteThread).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-delete-confirm")).toBeNull();
    unmount(app);
  });

  it("passes isArchiveMailbox/isTrashMailbox derived from the active mailbox's kind down to MessageList", () => {
    const vm = fakeVm({ mailboxes: [{ id: "ARCHIVE", name: "Archive", kind: "archive" }], activeMailboxId: "ARCHIVE" });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    // Archive mailbox: the thread row's own Archive button should be hidden.
    expect(host.querySelector('[data-action="archive"]')).toBeNull();
    expect(host.querySelector('[data-action="delete"]')).not.toBeNull();
    unmount(app);
  });
});
