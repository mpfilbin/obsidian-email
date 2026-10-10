import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import * as obsidian from "obsidian";
import App from "../../src/view/App.svelte";
import { THREAD_DRAG_TYPE } from "../../src/view/drag-types";
import type { ThreadView, ViewModel, ViewState } from "../../src/view/view-model";
import type { Mailbox } from "../../src/providers/types";

/** A one-message thread shaped like the fixture's default row, for the tests
 *  below that need a second row to act on. */
function threadView(threadId: string, messageId: string, subject: string): ThreadView {
  return {
    threadId, subject, lastDate: 1, unread: true,
    messages: [{
      id: messageId, threadId, mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
      to: [], cc: [], subject, snippet: "hi there", date: 1,
      unread: true, hasAttachments: false, flagged: false,
    }],
  };
}

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
    openThreadId: null, openMessages: [], pinnedThreadIds: [], flaggedActive: false,
    selectedThreadIds: [], selectionAnchorId: null,
    composer: null, mode: "mail",
    contacts: [], contactsStatus: "idle", contactSearch: "", selectedContactId: null, contactEdit: null,
    ribbonEnabled: true, ribbonCollapsedByDefault: false,
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
    selectAccount: vi.fn(), selectMailbox: vi.fn(), selectFlagged: vi.fn(), openThread: vi.fn(), closeThread: vi.fn(),
    loadMore: vi.fn(), refresh: vi.fn(), runSearch: vi.fn(), clearSearch: vi.fn(),
    renderDeps: () => ({ getInlineAttachment: async () => undefined, openExternal: () => {} }),
    downloadAttachment: vi.fn(), downloadAttachmentToDisk: vi.fn(),
    openReply: vi.fn(), openForward: vi.fn(),
    openNewMessage: vi.fn(() => {
      set({ composer: { mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "", attachments: [], sending: false, error: null, savedSnapshot: null } });
    }),
    openDraftForEdit: vi.fn(), updateComposerFields: vi.fn(), updateComposerBody: vi.fn(),
    hasUnsavedComposerContent: vi.fn().mockReturnValue(false),
    send: vi.fn(), saveDraft: vi.fn(), discardDraft: vi.fn(), closeComposer: vi.fn(),
    deleteMessage: vi.fn(), archiveMessage: vi.fn(), deleteThread: vi.fn(), archiveThread: vi.fn(),
    toggleThreadFlag: vi.fn(), flagThread: vi.fn(), flagThreadCustom: vi.fn(), completeThreadFlag: vi.fn(), toggleMessageFlag: vi.fn(), toggleThreadPin: vi.fn(),
    toggleThreadSelection: vi.fn(), selectThreadRange: vi.fn(), selectAllThreads: vi.fn(), clearSelection: vi.fn(),
    deleteThreads: vi.fn(), archiveThreads: vi.fn(), moveThreads: vi.fn(), markThreadsRead: vi.fn(),
    moveThread: vi.fn(), requestCreateMailbox: vi.fn(), renameMailbox: vi.fn(), deleteMailbox: vi.fn(),
    requestRenameMailbox: vi.fn(), requestAttachNote: vi.fn(), saveMessageToVault: vi.fn(), printMessage: vi.fn(),
    removeComposerAttachment: vi.fn(),
    setMode: vi.fn(), searchContacts: vi.fn(), selectContact: vi.fn(), newContact: vi.fn(), editContact: vi.fn(),
    updateContactDraft: vi.fn(), saveContact: vi.fn(), cancelContactEdit: vi.fn(), deleteContact: vi.fn(),
    emailContact: vi.fn(), refreshContacts: vi.fn(), grantContactsAccess: vi.fn(),
    suggestRecipients: vi.fn().mockReturnValue([]),
    hasUnsavedContactEdit: vi.fn().mockReturnValue(false),
    // Test-only escape hatch, so an overridden method can push state the way
    // the real ViewModel would (e.g. a saveDraft that sets composer.error).
    __setState: set,
  } as unknown as ViewModel;
}

/** The fixture's test-only state setter (see `__setState` above). */
const setStateOf = (vm: ViewModel) =>
  (vm as unknown as { __setState: (patch: Partial<ViewState>) => void }).__setState;

/** Every App mount needs the same four host callbacks; `over` swaps in the
 *  spies a given test actually asserts on. */
const appProps = (vm: ViewModel, over: object = {}) => ({
  vm,
  onAddAccount: () => {},
  onThreadContextMenu: () => {},
  onMailboxContextMenu: () => {},
  onBulkContextMenu: () => {},
  noteCommands: { composeFromNote: vi.fn(), composeWithNoteAttached: vi.fn() },
  ...over,
});

/** Clicks a ribbon command, selecting its tab first: an open composer pulls the
 *  ribbon to the contextual Message tab, so Home/Folder/Vault buttons are only
 *  in the DOM once their own tab is selected again. */
function clickRibbon(host: HTMLElement, tab: "home" | "folder" | "vault" | "message", action: string): void {
  host.querySelector<HTMLElement>(`.oe-ribbon-tab[data-tab="${tab}"]`)!.click();
  flushSync();
  host.querySelector<HTMLElement>(`.oe-ribbon [data-action="${action}"]`)!.click();
  flushSync();
}

describe("App.svelte smoke", () => {
  it("renders account, mailbox and thread rows", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(fakeVm()) });
    expect(host.textContent).toContain("Inbox");
    expect(host.textContent).toContain("Hello");
    expect(host.textContent).toContain("Jane");
    unmount(app);
  });

  it("shows a persistent 'Refreshing…' toast while any account is syncing, hidden once idle", () => {
    const hide = vi.fn();
    const noticeSpy = vi.spyOn(obsidian, "Notice").mockImplementation(() => ({ hide }) as never);
    const vm = fakeVm({ accounts: [{ id: "a1", email: "a1@x.com", provider: "ms-graph", status: "syncing" }] });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    expect(noticeSpy).toHaveBeenCalledTimes(1);
    expect(noticeSpy.mock.calls[0][1]).toBe(0); // duration 0: stays until explicitly hidden
    expect(hide).not.toHaveBeenCalled();

    setStateOf(vm)({ accounts: [{ id: "a1", email: "a1@x.com", provider: "ms-graph", status: "idle" }] });
    flushSync();
    expect(hide).toHaveBeenCalledOnce();
    unmount(app);
    noticeSpy.mockRestore();
  });

  it("shows no toast when idle", () => {
    const noticeSpy = vi.spyOn(obsidian, "Notice").mockImplementation(() => ({ hide: vi.fn() }) as never);
    const app = mount(App, { target: document.createElement("div"), props: appProps(fakeVm()) });
    flushSync();
    expect(noticeSpy).not.toHaveBeenCalled();
    unmount(app);
    noticeSpy.mockRestore();
  });

  it("renders two resizers and a reading pane by default", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(fakeVm()) });
    expect(host.querySelectorAll('[role="separator"]')).toHaveLength(2);
    expect(host.querySelector(".oe-reading-pane")).not.toBeNull();
    unmount(app);
  });

  it("collapses the reading pane via the ribbon's Close pane button, re-expanding to the last width when a message is opened", () => {
    const host = document.createElement("div");
    const vm = fakeVm({
      openThreadId: "t1",
      openMessages: [{ summary: {
        id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
        to: [], cc: [], subject: "Hello", snippet: "hi there", date: 1,
        unread: true, hasAttachments: false, flagged: false,
      } }],
    });
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    const gridEl = () => host.querySelector<HTMLElement>(".oe-grid")!;

    // Expanded: the message-list column sits at its stored width (340px default).
    expect(gridEl().getAttribute("style")).toContain("340px");

    clickRibbon(host, "home", "close-pane");
    // Collapsed: message-list column is flexible (calc), reading-pane column is 0.
    expect(gridEl().getAttribute("style")).not.toContain("340px");
    expect(gridEl().getAttribute("style")).toMatch(/0px 0px;/);

    host.querySelector<HTMLElement>(".oe-thread-row")!.click();
    flushSync();
    // Re-expanded via opening a message: back to the same stored width.
    expect(gridEl().getAttribute("style")).toContain("340px");
    expect(gridEl().getAttribute("style")).not.toMatch(/0px 0px;/);
    unmount(app);
  });

  it("clicking New message opens the new-message composer", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(fakeVm()) });
    flushSync();
    clickRibbon(host, "home", "new-message");
    expect(host.querySelector(".oe-composer")).not.toBeNull();
    unmount(app);
  });

  it("clicking the ribbon's New folder calls vm.requestCreateMailbox", () => {
    const requestCreateMailbox = vi.fn();
    const vm = fakeVm();
    Object.assign(vm, { requestCreateMailbox });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    clickRibbon(host, "folder", "new-folder");
    expect(requestCreateMailbox).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("widens the mailbox column when its resizer is dragged", () => {
    localStorage.clear();
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(fakeVm()) });
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
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    clickRibbon(host, "home", "new-message");
    expect(openNewMessage).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("switching composers with unsaved content shows a save/discard/cancel prompt instead of switching immediately", () => {
    const openNewMessage = vi.fn();
    const vm = fakeVm({ composer: {
      mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", attachments: [], sending: false, error: null, savedSnapshot: null,
    } });
    (vm as unknown as { openNewMessage: typeof openNewMessage; hasUnsavedComposerContent: () => boolean }).openNewMessage = openNewMessage;
    (vm as unknown as { hasUnsavedComposerContent: () => boolean }).hasUnsavedComposerContent = () => true;
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    clickRibbon(host, "home", "new-message");
    expect(openNewMessage).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();
    unmount(app);
  });

  it("prompt's Discard calls vm.discardDraft then proceeds with the pending switch", async () => {
    const discardDraft = vi.fn().mockResolvedValue(undefined);
    const openNewMessage = vi.fn();
    const vm = fakeVm({ composer: {
      mode: "reply", targetMessageId: "m1", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", attachments: [], sending: false, error: null, savedSnapshot: null,
    } });
    Object.assign(vm, { discardDraft, openNewMessage, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    clickRibbon(host, "home", "new-message");
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
      mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", attachments: [], sending: false, error: null, savedSnapshot: null,
    } });
    // saveDraft swallows its own errors and reports them through
    // composer.error rather than throwing, exactly as the ViewModel does.
    const saveDraft = vi.fn(async () => {
      setStateOf(vm)({ composer: { ...vm.getState().composer!, error: "network down" } });
    });
    Object.assign(vm, { saveDraft, openNewMessage, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    clickRibbon(host, "home", "new-message");
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
      mode: "editDraft", draftId: "d1", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", attachments: [], sending: false, error: null, savedSnapshot: null,
    } });
    const saveDraft = vi.fn().mockResolvedValue(undefined);
    Object.assign(vm, { saveDraft, openNewMessage, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    clickRibbon(host, "home", "new-message");
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
      mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", attachments: [], sending: false, error: null, savedSnapshot: null,
    } });
    Object.assign(vm, { openNewMessage, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    clickRibbon(host, "home", "new-message");
    host.querySelector<HTMLElement>(".oe-composer-prompt-cancel")!.click();
    flushSync();
    expect(openNewMessage).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).toBeNull();
    unmount(app);
  });

  it("opening a thread with an unmodified composer open goes straight through", () => {
    const openThread = vi.fn();
    const vm = fakeVm({ composer: {
      mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "", attachments: [], sending: false, error: null, savedSnapshot: null,
    } });
    Object.assign(vm, { openThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
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
      composer: { mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "", attachments: [], sending: false, error: null, savedSnapshot: null },
    });
    Object.assign(vm, { selectMailbox });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    host.querySelectorAll<HTMLElement>(".oe-mailbox:not(.oe-mailbox-flagged)")[1].click();
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
      composer: { mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", attachments: [], sending: false, error: null, savedSnapshot: null },
    });
    Object.assign(vm, { selectMailbox, openThread, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    host.querySelectorAll<HTMLElement>(".oe-mailbox:not(.oe-mailbox-flagged)")[1].click();
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

  it("offers Edit and disables Reply in the ribbon when the active mailbox kind is drafts", () => {
    // fakeVm's base fixture has an "m1" message but leaves openMessages empty
    // by default (no thread auto-opened); open it explicitly here so the ribbon
    // has a target message for the assertions below.
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
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    // Edit is Drafts-only (absent elsewhere); Reply stays visible but disabled.
    expect(host.querySelector('.oe-ribbon [data-action="edit-draft"]')).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>('.oe-ribbon [data-action="reply"]')!.disabled).toBe(true);
    unmount(app);
  });
});

describe("App.svelte — delete/archive wiring", () => {
  it("dropping a thread row onto a different mailbox calls vm.moveThread", () => {
    const moveThread = vi.fn();
    const vm = fakeVm({
      mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }, { id: "PROJ", name: "Project X", kind: "custom" }],
    });
    Object.assign(vm, { moveThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm, { onThreadContextMenu: vi.fn() }) });
    flushSync();
    const projRow = [...host.querySelectorAll<HTMLElement>(".oe-mailbox")].find((el) => el.textContent?.includes("Project X"))!;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { types: [THREAD_DRAG_TYPE], getData: () => "t1" } });
    projRow.dispatchEvent(event);
    expect(moveThread).toHaveBeenCalledWith("t1", "PROJ");
    unmount(app);
  });

  it("right-clicking a thread row offers every mailbox except the active one, and picking one calls vm.moveThread", () => {
    const moveThread = vi.fn();
    const vm = fakeVm({
      mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }, { id: "PROJ", name: "Project X", kind: "custom" }],
      activeMailboxId: "INBOX",
    });
    Object.assign(vm, { moveThread });
    const onThreadContextMenu = vi.fn();
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm, { onThreadContextMenu }) });
    flushSync();
    host.querySelector<HTMLElement>(".oe-thread-row")!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    expect(onThreadContextMenu).toHaveBeenCalledOnce();
    const [, actions] = onThreadContextMenu.mock.calls[0] as [MouseEvent, { candidates: Mailbox[]; onMove: (id: string) => void }];
    expect(actions.candidates.map((m) => m.id)).toEqual(["PROJ"]);

    actions.onMove("PROJ");
    expect(moveThread).toHaveBeenCalledWith("t1", "PROJ");
    unmount(app);
  });

  it("right-clicking a custom folder invokes onMailboxContextMenu with its name, and confirming calls vm.renameMailbox", () => {
    const renameMailbox = vi.fn();
    const vm = fakeVm({
      mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }, { id: "PROJ", name: "Project X", kind: "custom" }],
    });
    Object.assign(vm, { renameMailbox });
    const onMailboxContextMenu = vi.fn();
    const host = document.createElement("div");
    const app = mount(App, {
      target: host,
      props: appProps(vm, { onMailboxContextMenu }),
    });
    flushSync();
    const projRow = [...host.querySelectorAll<HTMLElement>(".oe-mailbox")].find((el) => el.textContent?.includes("Project X"))!;
    projRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(onMailboxContextMenu).toHaveBeenCalledOnce();
    const [, name, onRename] = onMailboxContextMenu.mock.calls[0] as [MouseEvent, string, (n: string) => void];
    expect(name).toBe("Project X");

    onRename("Project Y");
    expect(renameMailbox).toHaveBeenCalledWith("PROJ", "Project Y");
    unmount(app);
  });

  it("deleting a folder always shows a confirm prompt first, even outside Trash/search", () => {
    const deleteMailbox = vi.fn();
    const vm = fakeVm({
      mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }, { id: "PROJ", name: "Project X", kind: "custom" }],
    });
    Object.assign(vm, { deleteMailbox });
    const onMailboxContextMenu = vi.fn();
    const host = document.createElement("div");
    const app = mount(App, {
      target: host,
      props: appProps(vm, { onMailboxContextMenu }),
    });
    flushSync();
    const projRow = [...host.querySelectorAll<HTMLElement>(".oe-mailbox")].find((el) => el.textContent?.includes("Project X"))!;
    projRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const [, , , onDelete] = onMailboxContextMenu.mock.calls[0] as [MouseEvent, string, (n: string) => void, () => void];

    onDelete();
    flushSync();
    expect(deleteMailbox).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-delete-confirm")).not.toBeNull();

    host.querySelector<HTMLElement>(".oe-delete-confirm")!.click();
    expect(deleteMailbox).toHaveBeenCalledWith("PROJ");
    unmount(app);
  });

  it("canceling a folder-delete confirm prompt does not call vm.deleteMailbox", () => {
    const deleteMailbox = vi.fn();
    const vm = fakeVm({
      mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }, { id: "PROJ", name: "Project X", kind: "custom" }],
    });
    Object.assign(vm, { deleteMailbox });
    const onMailboxContextMenu = vi.fn();
    const host = document.createElement("div");
    const app = mount(App, {
      target: host,
      props: appProps(vm, { onMailboxContextMenu }),
    });
    flushSync();
    const projRow = [...host.querySelectorAll<HTMLElement>(".oe-mailbox")].find((el) => el.textContent?.includes("Project X"))!;
    projRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const [, , , onDelete] = onMailboxContextMenu.mock.calls[0] as [MouseEvent, string, (n: string) => void, () => void];

    onDelete();
    flushSync();
    host.querySelector<HTMLElement>(".oe-delete-cancel")!.click();
    flushSync();
    expect(deleteMailbox).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-delete-confirm")).toBeNull();
    unmount(app);
  });

  it("clicking Archive on a thread row calls vm.archiveThread", () => {
    const archiveThread = vi.fn();
    const vm = fakeVm();
    Object.assign(vm, { archiveThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    host.querySelector<HTMLElement>('.oe-thread-actions [data-action="archive"]')!.click();
    expect(archiveThread).toHaveBeenCalledWith("t1");
    unmount(app);
  });

  it("clicking Delete on a thread row in a normal mailbox calls vm.deleteThread immediately, no prompt", () => {
    const deleteThread = vi.fn();
    const vm = fakeVm();
    Object.assign(vm, { deleteThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    host.querySelector<HTMLElement>('.oe-thread-actions [data-action="delete"]')!.click();
    expect(deleteThread).toHaveBeenCalledWith("t1");
    expect(host.querySelector(".oe-delete-confirm")).toBeNull();
    unmount(app);
  });

  it("deleting the currently open thread collapses the reading pane, same as the ribbon's Close pane", () => {
    const deleteThread = vi.fn();
    const vm = fakeVm({ openThreadId: "t1" });
    Object.assign(vm, { deleteThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    const gridStyle = () => host.querySelector<HTMLElement>(".oe-grid")!.getAttribute("style");
    expect(gridStyle()).toContain("340px");

    host.querySelector<HTMLElement>('.oe-thread-actions [data-action="delete"]')!.click();
    expect(deleteThread).toHaveBeenCalledWith("t1");
    flushSync();
    expect(gridStyle()).not.toContain("340px");
    expect(gridStyle()).toMatch(/0px 0px;/);
    unmount(app);
  });

  it("deleting a thread row that is NOT the open thread leaves the reading pane as-is", () => {
    const deleteThread = vi.fn();
    const vm = fakeVm({ openThreadId: "other" });
    Object.assign(vm, { deleteThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    const gridStyle = () => host.querySelector<HTMLElement>(".oe-grid")!.getAttribute("style");

    host.querySelector<HTMLElement>('.oe-thread-actions [data-action="delete"]')!.click();
    expect(deleteThread).toHaveBeenCalledWith("t1");
    flushSync();
    expect(gridStyle()).toContain("340px");
    expect(gridStyle()).not.toMatch(/0px 0px;/);
    unmount(app);
  });

  it("deleting the currently open message collapses the reading pane", () => {
    const deleteMessage = vi.fn();
    const vm = fakeVm({
      openThreadId: "t1",
      openMessages: [{ summary: {
        id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
        to: [], cc: [], subject: "Hello", snippet: "hi there", date: 1,
        unread: true, hasAttachments: false, flagged: false,
      } }],
    });
    Object.assign(vm, { deleteMessage });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    const gridStyle = () => host.querySelector<HTMLElement>(".oe-grid")!.getAttribute("style");

    host.querySelector<HTMLElement>('.oe-ribbon [data-action="delete"]')!.click();
    expect(deleteMessage).toHaveBeenCalledWith("m1");
    flushSync();
    expect(gridStyle()).not.toContain("340px");
    expect(gridStyle()).toMatch(/0px 0px;/);
    unmount(app);
  });

  it("clicking Print prints the currently open message", () => {
    const printMessage = vi.fn();
    const vm = fakeVm({
      openThreadId: "t1",
      openMessages: [{ summary: {
        id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
        to: [], cc: [], subject: "Hello", snippet: "hi there", date: 1,
        unread: true, hasAttachments: false, flagged: false,
      } }],
    });
    Object.assign(vm, { printMessage });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();

    host.querySelector<HTMLElement>('.oe-ribbon [data-action="print"]')!.click();
    expect(printMessage).toHaveBeenCalledWith("m1");
    unmount(app);
  });

  it("clicking Delete on a thread row in the Trash mailbox shows a confirm prompt instead of deleting immediately", () => {
    const deleteThread = vi.fn();
    const vm = fakeVm({ mailboxes: [{ id: "TRASH", name: "Deleted Items", kind: "trash" }], activeMailboxId: "TRASH" });
    Object.assign(vm, { deleteThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    host.querySelector<HTMLElement>('.oe-thread-actions [data-action="delete"]')!.click();
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
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    host.querySelector<HTMLElement>('.oe-thread-actions [data-action="delete"]')!.click();
    flushSync();
    host.querySelector<HTMLElement>(".oe-delete-cancel")!.click();
    flushSync();
    expect(deleteThread).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-delete-confirm")).toBeNull();
    unmount(app);
  });

  it("ignores a Delete click on a Trash row while the compose-switch prompt is already showing", async () => {
    const deleteThread = vi.fn();
    const vm = fakeVm({
      mailboxes: [{ id: "TRASH", name: "Deleted Items", kind: "trash" }],
      activeMailboxId: "TRASH",
      composer: { mode: "reply", targetMessageId: "m1", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>hi</p>", attachments: [], sending: false, error: null, savedSnapshot: null },
    });
    Object.assign(vm, { deleteThread, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    // Trigger the switch prompt first, the same way
    // "navigating away with unsaved composer content prompts instead of
    // discarding it" (above) does: click a mailbox row while
    // hasUnsavedComposerContent() is true.
    host.querySelector<HTMLElement>('.oe-mailbox:not(.oe-mailbox-flagged)')!.click();
    flushSync();
    expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();

    // Now click Delete on the Trash row underneath — it should be ignored, not queued.
    host.querySelector<HTMLElement>('.oe-thread-actions [data-action="delete"]')!.click();
    flushSync();

    // Resolve the switch prompt.
    host.querySelector<HTMLElement>(".oe-composer-prompt-discard")!.click();
    // Two microtask ticks to drain the async handler's `await vm.discardDraft()`
    // continuation — matching the existing pattern above for flushing an
    // awaited mock (see "prompt's Discard calls vm.discardDraft...").
    await Promise.resolve();
    await Promise.resolve();
    flushSync();

    // The delete-confirm prompt must NOT have surfaced, and deleteThread must never have been called.
    expect(host.querySelector(".oe-delete-confirm")).toBeNull();
    expect(deleteThread).not.toHaveBeenCalled();
    unmount(app);
  });

  it("clears a pending delete-confirm when the user navigates away instead of resolving it", () => {
    const deleteThread = vi.fn();
    const vm = fakeVm({ mailboxes: [{ id: "TRASH", name: "Deleted Items", kind: "trash" }], activeMailboxId: "TRASH" });
    Object.assign(vm, { deleteThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();

    // Trigger the delete-confirm banner first.
    host.querySelector<HTMLElement>('.oe-thread-actions [data-action="delete"]')!.click();
    flushSync();
    expect(host.querySelector(".oe-delete-confirm")).not.toBeNull();

    // Navigate away without resolving it (click a mailbox — triggers requestSwitch).
    host.querySelector<HTMLElement>(".oe-mailbox:not(.oe-mailbox-flagged)")?.click();
    flushSync();

    // The stale delete-confirm must be gone, and the delete must never have fired.
    expect(host.querySelector(".oe-delete-confirm")).toBeNull();
    expect(deleteThread).not.toHaveBeenCalled();
    unmount(app);
  });

  it("archiving another thread with unsaved composer content prompts first, then proceeds once resolved", async () => {
    const archiveThread = vi.fn();
    const discardDraft = vi.fn().mockResolvedValue(undefined);
    // A reply composer open on t1 with typed content, acting on t2's row: the
    // ViewModel would close the thread (and with it the composer) behind the
    // user's back, so the save/discard prompt has to come first.
    const vm = fakeVm({
      threads: [threadView("t1", "m1", "Hello"), threadView("t2", "m2", "Second")],
      openThreadId: "t1",
      composer: { mode: "reply", targetMessageId: "m1", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>typed reply</p>", attachments: [], sending: false, error: null, savedSnapshot: null },
    });
    Object.assign(vm, { archiveThread, discardDraft, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();

    host.querySelectorAll<HTMLElement>('.oe-thread-actions [data-action="archive"]')[1].click();
    flushSync();
    expect(archiveThread).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();

    host.querySelector<HTMLElement>(".oe-composer-prompt-discard")!.click();
    // Two microtask ticks to drain the async handler's `await vm.discardDraft()`
    // continuation — matching the existing pattern above.
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(discardDraft).toHaveBeenCalledOnce();
    expect(archiveThread).toHaveBeenCalledWith("t2");
    unmount(app);
  });

  it("deleting another thread with unsaved composer content prompts first, then proceeds once resolved", async () => {
    const deleteThread = vi.fn();
    const discardDraft = vi.fn().mockResolvedValue(undefined);
    const vm = fakeVm({
      threads: [threadView("t1", "m1", "Hello"), threadView("t2", "m2", "Second")],
      openThreadId: "t1",
      composer: { mode: "reply", targetMessageId: "m1", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>typed reply</p>", attachments: [], sending: false, error: null, savedSnapshot: null },
    });
    Object.assign(vm, { deleteThread, discardDraft, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();

    host.querySelectorAll<HTMLElement>('.oe-thread-actions [data-action="delete"]')[1].click();
    flushSync();
    expect(deleteThread).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();

    host.querySelector<HTMLElement>(".oe-composer-prompt-discard")!.click();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    // Outside Trash and outside search, the delete needs no second prompt.
    expect(deleteThread).toHaveBeenCalledWith("t2");
    unmount(app);
  });

  it("archiving a message with unsaved composer content prompts first instead of dropping the composer", async () => {
    const archiveMessage = vi.fn();
    const discardDraft = vi.fn().mockResolvedValue(undefined);
    const vm = fakeVm({
      openThreadId: "t1",
      openMessages: [{ summary: {
        id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
        to: [], cc: [], subject: "Hello", snippet: "hi there", date: 1,
        unread: true, hasAttachments: false, flagged: false,
      } }],
      composer: { mode: "reply", targetMessageId: "m1", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>typed reply</p>", attachments: [], sending: false, error: null, savedSnapshot: null },
    });
    Object.assign(vm, { archiveMessage, discardDraft, hasUnsavedComposerContent: () => true });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();

    // The ribbon's Archive, which targets the expanded message — not a row.
    // The open composer parks the ribbon on the Message tab, so select Home first.
    clickRibbon(host, "home", "archive");
    expect(archiveMessage).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();

    host.querySelector<HTMLElement>(".oe-composer-prompt-discard")!.click();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(archiveMessage).toHaveBeenCalledWith("m1");
    unmount(app);
  });

  it("clicking Delete on a search result shows the confirm prompt even outside the Trash mailbox", () => {
    // Search spans every folder including Deleted Items, so a hit may already
    // be in Trash — where Graph's delete is permanent — while the active
    // mailbox is Inbox. Confirm unconditionally while a search is showing.
    const deleteThread = vi.fn();
    const vm = fakeVm({ search: { query: "report", active: true } });
    Object.assign(vm, { deleteThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    host.querySelector<HTMLElement>('.oe-thread-actions [data-action="delete"]')!.click();
    flushSync();
    expect(deleteThread).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-delete-confirm")).not.toBeNull();

    host.querySelector<HTMLElement>(".oe-delete-confirm")!.click();
    expect(deleteThread).toHaveBeenCalledWith("t1");
    unmount(app);
  });

  it("clicking Delete on a message in a search result also shows the confirm prompt", () => {
    const deleteMessage = vi.fn();
    const vm = fakeVm({
      search: { query: "report", active: true },
      openThreadId: "t1",
      openMessages: [{ summary: {
        id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
        to: [], cc: [], subject: "Hello", snippet: "hi there", date: 1,
        unread: true, hasAttachments: false, flagged: false,
      } }],
    });
    Object.assign(vm, { deleteMessage });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    host.querySelector<HTMLElement>('.oe-ribbon [data-action="delete"]')!.click();
    flushSync();
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-delete-confirm")).not.toBeNull();
    unmount(app);
  });

  it("passes isArchiveMailbox/isTrashMailbox derived from the active mailbox's kind down to MessageList", () => {
    const vm = fakeVm({ mailboxes: [{ id: "ARCHIVE", name: "Archive", kind: "archive" }], activeMailboxId: "ARCHIVE" });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    // Archive mailbox: the thread row's own Archive button should be hidden.
    expect(host.querySelector('.oe-thread-actions [data-action="archive"]')).toBeNull();
    expect(host.querySelector('.oe-thread-actions [data-action="delete"]')).not.toBeNull();
    unmount(app);
  });
});

describe("App.svelte — ribbon", () => {
  it("renders the ribbon above the grid when enabled", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(fakeVm()) });
    flushSync();
    expect(host.querySelector(".oe-shell > .oe-ribbon")).not.toBeNull();
    expect(host.querySelector(".oe-shell > .oe-grid")).not.toBeNull();
    unmount(app);
  });

  it("Refresh lives on the ribbon only — there is no refresh button near the search field", () => {
    const vm = fakeVm();
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    clickRibbon(host, "home", "search"); // open the search field
    expect(host.querySelector(".oe-search")).not.toBeNull();
    expect(host.querySelector(".oe-refresh")).toBeNull();
    host.querySelector<HTMLElement>('.oe-ribbon [data-action="refresh"]')!.click();
    expect(vm.refresh).toHaveBeenCalledOnce();
    unmount(app);
  });

  describe("search field", () => {
    // Focus only works on an element that is attached to the document.
    const mountAttached = (vm: ViewModel) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const app = mount(App, { target: host, props: appProps(vm) });
      flushSync();
      return { host, done: () => { unmount(app); host.remove(); } };
    };
    const input = (host: HTMLElement) => host.querySelector<HTMLInputElement>('.oe-search input[type="search"]')!;
    const searchOpen = (host: HTMLElement) => host.querySelector(".oe-search") !== null;

    it("is hidden until the ribbon's Search button is clicked", () => {
      const { host, done } = mountAttached(fakeVm());
      expect(searchOpen(host)).toBe(false);
      expect(host.querySelector('.oe-ribbon [data-action="search"]')!.getAttribute("aria-pressed")).toBe("false");
      clickRibbon(host, "home", "search");
      expect(searchOpen(host)).toBe(true);
      expect(host.querySelector('.oe-ribbon [data-action="search"]')!.getAttribute("aria-pressed")).toBe("true");
      done();
    });

    it("appears above the message list and takes focus", () => {
      const { host, done } = mountAttached(fakeVm());
      clickRibbon(host, "home", "search");
      expect(host.querySelector(".oe-list-col")!.firstElementChild!.classList.contains("oe-search")).toBe(true);
      expect(document.activeElement).toBe(input(host));
      done();
    });

    it("clicking the ribbon's Search button again closes it", () => {
      const { host, done } = mountAttached(fakeVm());
      clickRibbon(host, "home", "search");
      clickRibbon(host, "home", "search");
      expect(searchOpen(host)).toBe(false);
      expect(host.querySelector('.oe-ribbon [data-action="search"]')!.getAttribute("aria-pressed")).toBe("false");
      done();
    });

    it("submitting runs the search with the trimmed query — Enter is the only submit, there is no Search button", () => {
      const vm = fakeVm();
      const { host, done } = mountAttached(vm);
      clickRibbon(host, "home", "search");
      expect(host.querySelector('.oe-search button[type="submit"]')).toBeNull();
      expect(host.querySelectorAll(".oe-search button")).toHaveLength(1); // just the ✕
      input(host).value = "  report  ";
      input(host).dispatchEvent(new Event("input", { bubbles: true }));
      flushSync();
      host.querySelector(".oe-search")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      expect(vm.runSearch).toHaveBeenCalledWith("report");
      done();
    });

    it("the ✕ button hides the field and clears an active search", () => {
      const vm = fakeVm({ search: { query: "report", active: true } });
      const { host, done } = mountAttached(vm);
      clickRibbon(host, "home", "search");
      host.querySelector<HTMLElement>(".oe-search-close")!.click();
      flushSync();
      expect(searchOpen(host)).toBe(false);
      expect(vm.clearSearch).toHaveBeenCalledOnce();
      done();
    });

    it("the ✕ button just hides the field when no search is active", () => {
      const vm = fakeVm();
      const { host, done } = mountAttached(vm);
      clickRibbon(host, "home", "search");
      host.querySelector<HTMLElement>(".oe-search-close")!.click();
      flushSync();
      expect(searchOpen(host)).toBe(false);
      expect(vm.clearSearch).not.toHaveBeenCalled();
      done();
    });

    it("toggling closed from the ribbon also clears an active search", () => {
      const vm = fakeVm({ search: { query: "report", active: true } });
      const { host, done } = mountAttached(vm);
      clickRibbon(host, "home", "search");
      clickRibbon(host, "home", "search");
      expect(searchOpen(host)).toBe(false);
      expect(vm.clearSearch).toHaveBeenCalledOnce();
      done();
    });

    it("Escape in the field closes it", () => {
      const { host, done } = mountAttached(fakeVm());
      clickRibbon(host, "home", "search");
      input(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      flushSync();
      expect(searchOpen(host)).toBe(false);
      done();
    });

    it("no longer shows the old 'Search: … ✕' pill while a search is active", () => {
      const { host, done } = mountAttached(fakeVm({ search: { query: "report", active: true } }));
      clickRibbon(host, "home", "search");
      expect(host.querySelector(".oe-search-pill")).toBeNull();
      expect(input(host).value).toBe("report");
      done();
    });
  });

  it("renders no ribbon when the pref is off", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(fakeVm({ ribbonEnabled: false })) });
    flushSync();
    expect(host.querySelector(".oe-ribbon")).toBeNull();
    unmount(app);
  });

  it("Reply targets the expanded message and opens a reply composer", () => {
    const vm = fakeVm({ openThreadId: "t1", openMessages: [{ summary: threadView("t1", "m1", "Hello").messages[0], body: undefined }] });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    host.querySelector<HTMLElement>('.oe-ribbon [data-action="reply"]')!.click();
    expect(vm.openReply).toHaveBeenCalledWith("m1", "reply");
    unmount(app);
  });

  it("the ribbon's target message follows the expanded message and resets when the thread changes", () => {
    const messageFor = (threadId: string, id: string) => ({ summary: threadView(threadId, id, `S ${id}`).messages[0], body: undefined });
    const vm = fakeVm({ openThreadId: "t1", openMessages: [messageFor("t1", "m1"), messageFor("t1", "m2")] });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    const reply = () => host.querySelector<HTMLElement>('.oe-ribbon [data-action="reply"]')!.click();

    reply();
    expect(vm.openReply).toHaveBeenLastCalledWith("m2", "reply"); // defaults to the last message

    // Newest first: [m2, m1] — index 1 is the older message, m1.
    host.querySelectorAll<HTMLElement>(".oe-message-head")[1].click(); // expand m1
    flushSync();
    reply();
    expect(vm.openReply).toHaveBeenLastCalledWith("m1", "reply");

    setStateOf(vm)({ openThreadId: "t2", openMessages: [messageFor("t2", "n1"), messageFor("t2", "n2")] });
    flushSync();
    reply();
    expect(vm.openReply).toHaveBeenLastCalledWith("n2", "reply"); // manual expansion reset
    unmount(app);
  });

  it("passes the collapse-by-default pref through to the ribbon", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(fakeVm({ ribbonCollapsedByDefault: true })) });
    flushSync();
    expect(host.querySelector(".oe-ribbon")!.classList.contains("collapsed")).toBe(true);
    expect(host.querySelector(".oe-ribbon-panel")).toBeNull();
    unmount(app);
  });

  it("target message falls back to the last message when the expanded one is removed", () => {
    const messageFor = (id: string) => ({ summary: threadView("t1", id, `S ${id}`).messages[0], body: undefined });
    const [m0, m1, m2] = [messageFor("m0"), messageFor("m1"), messageFor("m2")];
    const vm = fakeVm({ openThreadId: "t1", openMessages: [m0, m1, m2] });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    const reply = () => host.querySelector<HTMLElement>('.oe-ribbon [data-action="reply"]')!.click();

    // Newest first: [m2, m1, m0] — index 1 is the middle message, m1.
    host.querySelectorAll<HTMLElement>(".oe-message-head")[1].click(); // expand m1
    flushSync();
    reply();
    expect(vm.openReply).toHaveBeenLastCalledWith("m1", "reply");

    setStateOf(vm)({ openMessages: [m0, m2] }); // m1 removed, first id unchanged
    flushSync();
    reply();
    expect(vm.openReply).toHaveBeenLastCalledWith("m2", "reply");
    unmount(app);
  });

  describe("with a top-level composer hiding the open thread", () => {
    const composerOf = (mode: "new" | "editDraft" | "reply") => ({
      mode, to: [], cc: [], bcc: [], subject: "", bodyHtml: "", attachments: [], sending: false, error: null, savedSnapshot: null,
    });
    const openThreadState = (): Partial<ViewState> => ({
      openThreadId: "t1",
      openMessages: [{ summary: threadView("t1", "m1", "Hello").messages[0], body: undefined }],
      mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }, { id: "P", name: "Project", kind: "custom" }],
    });
    const isDisabled = (host: HTMLElement, tab: string, action: string): boolean => {
      host.querySelector<HTMLElement>(`.oe-ribbon-tab[data-tab="${tab}"]`)!.click();
      flushSync();
      return host.querySelector<HTMLButtonElement>(`.oe-ribbon [data-action="${action}"]`)!.disabled;
    };

    it("disables the message-targeting actions for a new-message composer", () => {
      const vm = fakeVm({ ...openThreadState(), composer: composerOf("new") });
      const host = document.createElement("div");
      const app = mount(App, { target: host, props: appProps(vm) });
      flushSync();
      for (const action of ["reply", "archive", "delete", "move"]) {
        expect(isDisabled(host, "home", action), action).toBe(true);
      }
      expect(isDisabled(host, "vault", "save-to-vault")).toBe(true);
      unmount(app);
    });

    it("disables them for an edit-draft composer too", () => {
      const vm = fakeVm({ ...openThreadState(), composer: composerOf("editDraft") });
      const host = document.createElement("div");
      const app = mount(App, { target: host, props: appProps(vm) });
      flushSync();
      expect(isDisabled(host, "home", "reply")).toBe(true);
      expect(isDisabled(host, "home", "delete")).toBe(true);
      unmount(app);
    });

    it("keeps them enabled for an inline reply composer (the message is still on screen)", () => {
      const vm = fakeVm({ ...openThreadState(), composer: composerOf("reply") });
      const host = document.createElement("div");
      const app = mount(App, { target: host, props: appProps(vm) });
      flushSync();
      for (const action of ["reply", "archive", "delete", "move"]) {
        expect(isDisabled(host, "home", action), action).toBe(false);
      }
      expect(isDisabled(host, "vault", "save-to-vault")).toBe(false);
      unmount(app);
    });
  });

  it("Email from note goes through the unsaved-composer guard", () => {
    const vm = fakeVm();
    const noteCommands = { composeFromNote: vi.fn(), composeWithNoteAttached: vi.fn() };
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm, { noteCommands }) });
    flushSync();
    clickRibbon(host, "vault", "email-from-note");
    expect(noteCommands.composeFromNote).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("Send/Save draft/Discard live on the contextual Message tab and call the view model", () => {
    const vm = fakeVm();
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    setStateOf(vm)({ composer: { mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "", attachments: [], sending: false, error: null, savedSnapshot: null } });
    flushSync();
    expect(host.querySelector('.oe-ribbon-tab[data-tab="message"]')!.classList.contains("active")).toBe(true);
    host.querySelector<HTMLElement>('.oe-ribbon [data-action="send"]')!.click();
    host.querySelector<HTMLElement>('.oe-ribbon [data-action="save-draft"]')!.click();
    host.querySelector<HTMLElement>('.oe-ribbon [data-action="discard-draft"]')!.click();
    expect(vm.send).toHaveBeenCalledOnce();
    expect(vm.saveDraft).toHaveBeenCalledOnce();
    expect(vm.discardDraft).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("Rename/Delete folder are enabled for a custom active folder and route to the view model", () => {
    const vm = fakeVm({
      mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }, { id: "P", name: "Project", kind: "custom" }],
      activeMailboxId: "P",
    });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    clickRibbon(host, "folder", "rename-folder");
    expect(vm.requestRenameMailbox).toHaveBeenCalledWith("P");
    clickRibbon(host, "folder", "delete-folder");
    expect(host.querySelector(".oe-delete-confirm")).not.toBeNull();
    unmount(app);
  });
});

describe("App — contacts mode", () => {
  const ada = { id: "C1", displayName: "Ada Lovelace", emails: [{ email: "ada@x.com" }], businessPhones: [], homePhones: [] };
  const bob = { id: "C2", displayName: "Bob", emails: [], businessPhones: [], homePhones: [] };
  const mountApp = (vm: ViewModel) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    return { host, done: () => { unmount(app); host.remove(); } };
  };
  const click = (el: Element | null) => { (el as HTMLElement).click(); flushSync(); };
  const q = (host: HTMLElement, sel: string) => host.querySelector<HTMLElement>(sel);

  it("mail mode shows mailboxes and messages, not contacts", () => {
    const { host, done } = mountApp(fakeVm());
    expect(q(host, ".oe-mailbox")).not.toBeNull();
    expect(q(host, ".oe-contact-row")).toBeNull();
    done();
  });

  it("the ribbon Contacts button switches to contacts mode", () => {
    const vm = fakeVm();
    const { host, done } = mountApp(vm);
    click(q(host, '[data-action="contacts"]'));
    expect(vm.setMode).toHaveBeenCalledWith("contacts");
    done();
  });

  it("in contacts mode the columns become address book / contact list / contact pane", () => {
    const { host, done } = mountApp(fakeVm({ mode: "contacts", contacts: [ada, bob] }));
    expect(host.textContent).toContain("All contacts");
    expect(host.querySelectorAll(".oe-contact-row")).toHaveLength(2);
    expect(host.textContent).toContain("Select a contact");
    expect(q(host, ".oe-thread-row")).toBeNull();
    expect(q(host, '.oe-ribbon-tab[data-tab="contacts"]')!.classList.contains("active")).toBe(true);
    done();
  });

  it("the contact search filters the list client-side and reports the query to the view-model", () => {
    const vm = fakeVm({ mode: "contacts", contacts: [ada, bob], contactSearch: "ada" });
    const { host, done } = mountApp(vm);
    expect([...host.querySelectorAll(".oe-contact-name")].map((e) => e.textContent)).toEqual(["Ada Lovelace"]);
    const input = q(host, 'input[data-field="contact-search"]') as HTMLInputElement;
    input.value = "b";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(vm.searchContacts).toHaveBeenCalledWith("b");
    done();
  });

  it("selecting a contact shows its detail; Edit and Email route through the view-model", () => {
    const vm = fakeVm({ mode: "contacts", contacts: [ada], selectedContactId: "C1" });
    const { host, done } = mountApp(vm);
    expect(q(host, ".oe-contact-detail")!.textContent).toContain("Ada Lovelace");
    click(host.querySelectorAll(".oe-contact-row")[0]);
    expect(vm.selectContact).toHaveBeenCalledWith("C1");
    click(q(host, ".oe-contact-edit"));
    expect(vm.editContact).toHaveBeenCalledWith("C1");
    click(q(host, ".oe-contact-email"));
    expect(vm.emailContact).toHaveBeenCalledWith("C1", "ada@x.com");
    done();
  });

  it("ribbon New/Edit/Email/Refresh contact commands call the view-model", () => {
    const vm = fakeVm({ mode: "contacts", contacts: [ada], selectedContactId: "C1" });
    const { host, done } = mountApp(vm);
    click(q(host, '[data-action="new-contact"]'));
    expect(vm.newContact).toHaveBeenCalledOnce();
    click(q(host, '[data-action="edit-contact"]'));
    expect(vm.editContact).toHaveBeenCalledWith("C1");
    click(q(host, '[data-action="email-contact"]'));
    expect(vm.emailContact).toHaveBeenCalledWith("C1");
    click(q(host, '[data-action="refresh-contacts"]'));
    expect(vm.refreshContacts).toHaveBeenCalledOnce();
    done();
  });

  it("deleting a contact asks for confirmation first", () => {
    const vm = fakeVm({ mode: "contacts", contacts: [ada], selectedContactId: "C1" });
    const { host, done } = mountApp(vm);
    click(q(host, ".oe-contact-delete"));
    expect(vm.deleteContact).not.toHaveBeenCalled();
    expect(q(host, ".oe-composer-prompt")!.textContent).toMatch(/delete this contact/i);
    click(q(host, ".oe-delete-cancel"));
    expect(vm.deleteContact).not.toHaveBeenCalled();
    click(q(host, '[data-action="delete-contact"]'));
    click(q(host, ".oe-delete-confirm"));
    expect(vm.deleteContact).toHaveBeenCalledWith("C1");
    done();
  });

  for (const [label, sel] of [["the detail's Edit", ".oe-contact-edit"], ["the ribbon Edit", '[data-action="edit-contact"]']] as const) {
    it(`${label} clears a pending delete confirmation`, () => {
      const vm = fakeVm({ mode: "contacts", contacts: [ada], selectedContactId: "C1" });
      const { host, done } = mountApp(vm);
      click(q(host, ".oe-contact-delete"));
      expect(q(host, ".oe-composer-prompt")).not.toBeNull();

      click(q(host, sel));

      expect(vm.editContact).toHaveBeenCalledWith("C1");
      // A confirmation left standing would delete the contact being edited.
      expect(q(host, ".oe-composer-prompt")).toBeNull();
      expect(vm.deleteContact).not.toHaveBeenCalled();
      done();
    });
  }

  it("the form's Save/Cancel and the grant button call the view-model", () => {
    const edit = { mode: "new" as const, seq: 1, draft: { displayName: "", emails: [], businessPhones: [], homePhones: [] }, saved: { displayName: "", emails: [], businessPhones: [], homePhones: [] }, error: null, saving: false };
    const vm = fakeVm({ mode: "contacts", contacts: [], contactEdit: edit, contactsStatus: "needs-consent" });
    const { host, done } = mountApp(vm);
    click(q(host, ".oe-contact-save"));
    expect(vm.saveContact).toHaveBeenCalledOnce();
    click(q(host, ".oe-contact-cancel"));
    expect(vm.cancelContactEdit).toHaveBeenCalledOnce();
    click(q(host, ".oe-grant-contacts"));
    expect(vm.grantContactsAccess).toHaveBeenCalledOnce();
    done();
  });

  it("Edit and Delete are disabled (ribbon and inline) while access is blocked", () => {
    const vm = fakeVm({ mode: "contacts", contacts: [ada], selectedContactId: "C1", contactsStatus: "needs-reauth" });
    const { host, done } = mountApp(vm);
    for (const sel of ['[data-action="edit-contact"]', '[data-action="delete-contact"]', ".oe-contact-edit", ".oe-contact-delete"]) {
      expect(q(host, sel)!.hasAttribute("disabled"), sel).toBe(true);
    }
    expect(q(host, '[data-action="email-contact"]')!.hasAttribute("disabled")).toBe(false);
    done();
  });

  it("New contact is disabled while access is blocked", () => {
    const { host, done } = mountApp(fakeVm({ mode: "contacts", contactsStatus: "needs-consent" }));
    expect(q(host, '[data-action="new-contact"]')!.hasAttribute("disabled")).toBe(true);
    done();
  });

  it("leaving contacts mode, selecting a contact, or switching account with an unsaved form prompts first", () => {
    const vm = fakeVm({ mode: "contacts", contacts: [ada, bob] });
    (vm.hasUnsavedContactEdit as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const { host, done } = mountApp(vm);
    click(host.querySelectorAll(".oe-contact-row")[1]);
    expect(vm.selectContact).not.toHaveBeenCalled();
    expect(q(host, ".oe-composer-prompt")!.textContent).toMatch(/unsaved contact/i);
    click(q(host, ".oe-contact-keep"));
    expect(q(host, ".oe-composer-prompt")).toBeNull();
    click(q(host, '[data-action="show-mail"]'));
    expect(vm.setMode).not.toHaveBeenCalled();
    click(q(host, ".oe-contact-discard"));
    expect(vm.cancelContactEdit).toHaveBeenCalledOnce();
    expect(vm.setMode).toHaveBeenCalledWith("mail");
    click(q(host, ".oe-account")); // account switch is guarded too
    expect(vm.selectAccount).not.toHaveBeenCalled();
    done();
  });

  it("wires composer autocomplete to the view-model", () => {
    const vm = fakeVm();
    (vm.suggestRecipients as ReturnType<typeof vi.fn>).mockReturnValue([{ name: "Ada", email: "ada@x.com" }]);
    const { host, done } = mountApp(vm);
    click(q(host, '[data-action="new-message"]'));
    const to = q(host, 'input[data-field="to"]') as HTMLInputElement;
    to.value = "a";
    to.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(vm.suggestRecipients).toHaveBeenCalledWith("a", []);
    expect(host.querySelectorAll(".oe-suggest-item")).toHaveLength(1);
    done();
  });
});

describe("App — flagging", () => {
  const openState = {
    openThreadId: "t1",
    openMessages: [{
      summary: {
        id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
        to: [], cc: [], subject: "Hello", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: true,
      },
    }],
  };
  const mountApp = (vm: ViewModel, over: object = {}) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(App, { target: host, props: appProps(vm, over) });
    flushSync();
    return { host, done: () => { unmount(app); host.remove(); } };
  };
  const click = (el: Element | null) => { (el as HTMLElement).click(); flushSync(); };

  it("the row Flag button toggles that thread", () => {
    const vm = fakeVm();
    const { host, done } = mountApp(vm);
    click(host.querySelector('.oe-thread-row [data-action="flag"]'));
    expect(vm.toggleThreadFlag).toHaveBeenCalledWith("t1");
    done();
  });

  it("the ribbon Flag button toggles the open thread and shows pressed when it has a flagged message", () => {
    const vm = fakeVm(openState);
    const { host, done } = mountApp(vm);
    const btn = host.querySelector<HTMLElement>('.oe-ribbon [data-action="flag"]')!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    click(btn);
    expect(vm.toggleThreadFlag).toHaveBeenCalledWith("t1");
    done();
  });

  it("a message header flag toggles that message", () => {
    const vm = fakeVm(openState);
    const { host, done } = mountApp(vm);
    click(host.querySelector(".oe-message-flag"));
    expect(vm.toggleMessageFlag).toHaveBeenCalledWith("m1");
    done();
  });

  it("the thread context menu receives flag state and a working toggle", () => {
    const onThreadContextMenu = vi.fn();
    const vm = fakeVm();
    const { host, done } = mountApp(vm, { onThreadContextMenu });
    host.querySelector(".oe-thread-row")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(onThreadContextMenu).toHaveBeenCalledOnce();
    const [, actions] = onThreadContextMenu.mock.calls[0];
    expect(actions.flagged).toBe(false);
    expect(Array.isArray(actions.candidates)).toBe(true);
    actions.onToggleFlag();
    expect(vm.toggleThreadFlag).toHaveBeenCalledWith("t1");
    done();
  });
});

describe("App — follow-up flags", () => {
  const mountApp = (vm: ViewModel, over: object = {}) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(App, { target: host, props: appProps(vm, over) });
    flushSync();
    return { host, done: () => { unmount(app); host.remove(); } };
  };
  const click = (el: Element | null) => { (el as HTMLElement).click(); flushSync(); };
  const openMessages = [{
    summary: {
      id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
      to: [], cc: [], subject: "Hello", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: true,
    },
  }];

  it("the thread context menu's follow-up and complete actions act on that thread", () => {
    const onThreadContextMenu = vi.fn();
    const vm = fakeVm();
    const { host, done } = mountApp(vm, { onThreadContextMenu });
    host.querySelector(".oe-thread-row")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const [, actions] = onThreadContextMenu.mock.calls[0];
    actions.onFlagFollowUp(1234);
    expect(vm.flagThread).toHaveBeenCalledWith("t1", 1234);
    actions.onFlagCustomFollowUp();
    expect(vm.flagThreadCustom).toHaveBeenCalledWith("t1");
    actions.onCompleteFlag();
    expect(vm.completeThreadFlag).toHaveBeenCalledWith("t1");
    done();
  });

  it("the ribbon Follow up dropdown's Custom date asks for a date for the open thread", () => {
    const vm = fakeVm({ openThreadId: "t1", openMessages });
    const { host, done } = mountApp(vm);
    click(host.querySelector('.oe-ribbon [data-action="follow-up"]'));
    const custom = [...document.querySelectorAll<HTMLElement>(".oe-ribbon-menu button")].find((i) => i.textContent?.includes("Custom date"));
    expect(custom).toBeDefined();
    click(custom!);
    expect(vm.flagThreadCustom).toHaveBeenCalledWith("t1");
    done();
  });

  it("the ribbon Complete button completes the open thread's flag", () => {
    const vm = fakeVm({ openThreadId: "t1", openMessages });
    const { host, done } = mountApp(vm);
    click(host.querySelector('.oe-ribbon [data-action="complete-flag"]'));
    expect(vm.completeThreadFlag).toHaveBeenCalledWith("t1");
    done();
  });

  it("the ribbon Follow up dropdown flags the open thread with a due date", () => {
    const vm = fakeVm({ openThreadId: "t1", openMessages });
    const { host, done } = mountApp(vm);
    click(host.querySelector('.oe-ribbon [data-action="follow-up"]'));
    const items = [...document.querySelectorAll<HTMLElement>(".oe-ribbon-menu button, .oe-ribbon-menu [role=menuitem]")];
    const tomorrow = items.find((i) => i.textContent?.trim() === "Tomorrow");
    expect(tomorrow).toBeDefined();
    click(tomorrow!);
    expect(vm.flagThread).toHaveBeenCalledWith("t1", expect.any(Number));
    done();
  });
});

describe("App — multi-select and bulk actions", () => {
  const mountApp = (vm: ViewModel, over: object = {}) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(App, { target: host, props: appProps(vm, over) });
    flushSync();
    return { host, done: () => { unmount(app); host.remove(); } };
  };
  const click = (el: Element | null) => { (el as HTMLElement).click(); flushSync(); };
  const three = () => [threadView("t1", "m1", "One"), threadView("t2", "m2", "Two"), threadView("t3", "m3", "Three")];
  const boxes: Mailbox[] = [
    { id: "INBOX", name: "Inbox", kind: "inbox" },
    { id: "ARCHIVE", name: "Archive", kind: "archive" },
    { id: "P", name: "Projects", kind: "custom" },
  ];
  const withSelection = (over: Partial<ViewState> = {}) =>
    fakeVm({ threads: three(), mailboxes: boxes, selectedThreadIds: ["t1", "t2"], ...over });
  const bar = (host: HTMLElement) => host.querySelector<HTMLElement>(".oe-bulk-bar");
  const action = (host: HTMLElement, name: string) => host.querySelector<HTMLElement>(`.oe-bulk-bar [data-action="${name}"]`);
  const rightClick = (el: Element) => { el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); flushSync(); };

  it("shows the bulk bar only while something is selected", () => {
    const none = mountApp(fakeVm({ threads: three() }));
    expect(bar(none.host)).toBeNull();
    none.done();
    const some = mountApp(withSelection());
    expect(bar(some.host)).not.toBeNull();
    expect(some.host.querySelector(".oe-bulk-count")!.textContent).toBe("2 selected");
    some.done();
  });

  it("ticks rows with Ctrl-click and Shift-click, and a plain click still opens", () => {
    const vm = fakeVm({ threads: three() });
    const { host, done } = mountApp(vm);
    const rows = host.querySelectorAll<HTMLElement>(".oe-thread-row");
    rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    expect(vm.toggleThreadSelection).toHaveBeenCalledWith("t1");
    rows[2].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    expect(vm.selectThreadRange).toHaveBeenCalledWith("t3");
    expect(vm.openThread).not.toHaveBeenCalled();
    rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(vm.openThread).toHaveBeenCalledWith("t2");
    done();
  });

  it("Select all and Clear drive the view-model", () => {
    const vm = withSelection();
    const { host, done } = mountApp(vm);
    click(action(host, "select-all"));
    expect(vm.selectAllThreads).toHaveBeenCalledOnce();
    click(action(host, "clear"));
    expect(vm.clearSelection).toHaveBeenCalledOnce();
    done();
  });

  it("Escape in the list drops the selection, but not when nothing is selected", () => {
    const vm = withSelection();
    const { host, done } = mountApp(vm);
    host.querySelector(".oe-list-col")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(vm.clearSelection).toHaveBeenCalledOnce();
    done();
    const idle = fakeVm({ threads: three() });
    const b = mountApp(idle);
    b.host.querySelector(".oe-list-col")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(idle.clearSelection).not.toHaveBeenCalled();
    b.done();
  });

  it("Unread and Read mark the selected conversations", () => {
    const vm = withSelection();
    const { host, done } = mountApp(vm);
    click(action(host, "mark-unread"));
    expect(vm.markThreadsRead).toHaveBeenLastCalledWith(["t1", "t2"], false);
    click(action(host, "mark-read"));
    expect(vm.markThreadsRead).toHaveBeenLastCalledWith(["t1", "t2"], true);
    done();
  });

  it("Archive archives the selection, and is absent in Archive / Drafts / Trash", () => {
    const vm = withSelection();
    const { host, done } = mountApp(vm);
    click(action(host, "archive"));
    expect(vm.archiveThreads).toHaveBeenCalledWith(["t1", "t2"]);
    done();
    for (const kind of ["archive", "drafts", "trash"] as const) {
      const other = fakeVm({
        threads: three(), selectedThreadIds: ["t1"], activeMailboxId: "X",
        mailboxes: [{ id: "X", name: "X", kind }, { id: "INBOX", name: "Inbox", kind: "inbox" }],
      });
      const b = mountApp(other);
      expect(action(b.host, "archive"), kind).toBeNull();
      b.done();
    }
  });

  it("Move sends the selection to the chosen folder, and lists every other folder", () => {
    const vm = withSelection();
    const { host, done } = mountApp(vm);
    const select = host.querySelector<HTMLSelectElement>('.oe-bulk-bar select[data-action="move"]')!;
    expect([...select.options].slice(1).map((o) => o.value)).toEqual(["ARCHIVE", "P"]);
    select.value = "P";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(vm.moveThreads).toHaveBeenCalledWith(["t1", "t2"], "P");
    done();
  });

  it("Delete outside Trash deletes at once, with no prompt", () => {
    const vm = withSelection();
    const { host, done } = mountApp(vm);
    click(action(host, "delete"));
    expect(vm.deleteThreads).toHaveBeenCalledWith(["t1", "t2"]);
    expect(host.querySelector(".oe-composer-prompt")).toBeNull();
    done();
  });

  it("Delete in Trash asks first — naming the count — and only deletes once confirmed", () => {
    const vm = withSelection({
      activeMailboxId: "TRASH",
      mailboxes: [{ id: "TRASH", name: "Deleted Items", kind: "trash" }, ...boxes],
    });
    const { host, done } = mountApp(vm);
    click(action(host, "delete"));
    expect(vm.deleteThreads).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt p")!.textContent).toBe("Permanently delete these 2 threads? This can't be undone.");
    click(host.querySelector(".oe-delete-confirm"));
    expect(vm.deleteThreads).toHaveBeenCalledWith(["t1", "t2"]);
    done();
  });

  it("Delete while a search is showing also asks first, and Cancel deletes nothing", () => {
    const vm = withSelection({ search: { query: "q", active: true } });
    const { host, done } = mountApp(vm);
    click(action(host, "delete"));
    expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();
    click(host.querySelector(".oe-delete-cancel"));
    expect(vm.deleteThreads).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).toBeNull();
    done();
  });

  it("a single-thread delete confirmation keeps its singular wording", () => {
    const vm = fakeVm({
      threads: three(), selectedThreadIds: [], activeMailboxId: "TRASH",
      mailboxes: [{ id: "TRASH", name: "Deleted Items", kind: "trash" }],
    });
    const { host, done } = mountApp(vm);
    click(host.querySelector('.oe-thread-row [data-action="delete"]'));
    expect(host.querySelector(".oe-composer-prompt p")!.textContent).toBe("Permanently delete this thread? This can't be undone.");
    done();
  });

  it("archive / move / delete go through the unsaved-composer prompt; mark read does not", () => {
    const vm = withSelection();
    (vm.hasUnsavedComposerContent as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const { host, done } = mountApp(vm);
    click(action(host, "mark-read"));
    expect(vm.markThreadsRead).toHaveBeenCalledOnce();
    click(action(host, "archive"));
    expect(vm.archiveThreads).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();
    click(host.querySelector(".oe-composer-prompt-discard"));
    expect(vm.discardDraft).toHaveBeenCalledOnce();
    done();
  });

  it("acting on a selection that includes the open thread still sends the whole selection", () => {
    const vm = withSelection({ openThreadId: "t2", openMessages: [{ summary: three()[1].messages[0] }] });
    const { host, done } = mountApp(vm);
    expect(host.querySelector(".oe-reading-pane")).not.toBeNull();
    click(action(host, "archive"));
    expect(vm.archiveThreads).toHaveBeenCalledWith(["t1", "t2"]);
    done();
  });

  describe("ribbon Manage buttons", () => {
    const ribbonBtn = (host: HTMLElement, name: string) => host.querySelector<HTMLButtonElement>(`.oe-ribbon [data-action="${name}"]`)!;
    const openMessage = { summary: three()[2].messages[0] };

    it("are disabled with nothing selected or open, and enabled once something is ticked", () => {
      const idle = mountApp(fakeVm({ threads: three(), mailboxes: boxes }));
      for (const name of ["archive", "delete", "move"]) expect(ribbonBtn(idle.host, name).disabled, name).toBe(true);
      idle.done();
      const ticked = mountApp(withSelection());
      for (const name of ["archive", "delete", "move"]) expect(ribbonBtn(ticked.host, name).disabled, name).toBe(false);
      ticked.done();
    });

    it("Archive archives the whole selection", () => {
      const vm = withSelection();
      const { host, done } = mountApp(vm);
      click(ribbonBtn(host, "archive"));
      expect(vm.archiveThreads).toHaveBeenCalledWith(["t1", "t2"]);
      expect(vm.archiveMessage).not.toHaveBeenCalled();
      done();
    });

    it("Delete deletes the whole selection, with no prompt outside Deleted Items / search", () => {
      const vm = withSelection();
      const { host, done } = mountApp(vm);
      click(ribbonBtn(host, "delete"));
      expect(vm.deleteThreads).toHaveBeenCalledWith(["t1", "t2"]);
      expect(vm.deleteMessage).not.toHaveBeenCalled();
      expect(host.querySelector(".oe-composer-prompt")).toBeNull();
      done();
    });

    it("Delete in Deleted Items asks first, naming the count, then deletes the selection", () => {
      const vm = withSelection({ activeMailboxId: "TRASH", mailboxes: [{ id: "TRASH", name: "Deleted Items", kind: "trash" }, ...boxes] });
      const { host, done } = mountApp(vm);
      click(ribbonBtn(host, "delete"));
      expect(vm.deleteThreads).not.toHaveBeenCalled();
      expect(host.querySelector(".oe-composer-prompt p")!.textContent).toBe("Permanently delete these 2 threads? This can't be undone.");
      click(host.querySelector(".oe-delete-confirm"));
      expect(vm.deleteThreads).toHaveBeenCalledWith(["t1", "t2"]);
      done();
    });

    it("Move moves the whole selection to the chosen folder", () => {
      const vm = withSelection();
      const { host, done } = mountApp(vm);
      click(ribbonBtn(host, "move"));
      click(document.querySelector('.oe-ribbon-menu [data-option="P"]'));
      expect(vm.moveThreads).toHaveBeenCalledWith(["t1", "t2"], "P");
      expect(vm.moveThread).not.toHaveBeenCalled();
      done();
    });

    it("the selection wins over the open conversation", () => {
      const vm = withSelection({ openThreadId: "t3", openMessages: [openMessage] });
      const { host, done } = mountApp(vm);
      click(ribbonBtn(host, "archive"));
      click(ribbonBtn(host, "delete"));
      expect(vm.archiveThreads).toHaveBeenCalledWith(["t1", "t2"]);
      expect(vm.deleteThreads).toHaveBeenCalledWith(["t1", "t2"]);
      expect(vm.archiveMessage).not.toHaveBeenCalled();
      expect(vm.deleteMessage).not.toHaveBeenCalled();
      done();
    });

    it("with nothing ticked they still act on the open conversation (unchanged)", () => {
      const vm = fakeVm({ threads: three(), mailboxes: boxes, openThreadId: "t3", openMessages: [openMessage] });
      const { host, done } = mountApp(vm);
      click(ribbonBtn(host, "archive"));
      expect(vm.archiveMessage).toHaveBeenCalledWith("m3");
      expect(vm.archiveThreads).not.toHaveBeenCalled();
      done();
    });

    it("Archive stays disabled in Deleted Items even with a selection; Delete does not", () => {
      const vm = withSelection({ activeMailboxId: "TRASH", mailboxes: [{ id: "TRASH", name: "Deleted Items", kind: "trash" }, ...boxes] });
      const { host, done } = mountApp(vm);
      expect(ribbonBtn(host, "archive").disabled).toBe(true);
      expect(ribbonBtn(host, "delete").disabled).toBe(false);
      done();
    });

    it("Move with nothing ticked still moves the open conversation (unchanged)", () => {
      const vm = fakeVm({ threads: three(), mailboxes: boxes, openThreadId: "t3", openMessages: [openMessage] });
      const { host, done } = mountApp(vm);
      click(ribbonBtn(host, "move"));
      click(document.querySelector('.oe-ribbon-menu [data-option="P"]'));
      expect(vm.moveThread).toHaveBeenCalledWith("t3", "P");
      expect(vm.moveThreads).not.toHaveBeenCalled();
      done();
    });

    it("goes through the unsaved-composer prompt like the bar does", () => {
      const vm = withSelection();
      (vm.hasUnsavedComposerContent as ReturnType<typeof vi.fn>).mockReturnValue(true);
      const { host, done } = mountApp(vm);
      click(ribbonBtn(host, "archive"));
      expect(vm.archiveThreads).not.toHaveBeenCalled();
      expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();
      done();
    });
  });

  describe("closing the reading pane when the open conversation is acted on", () => {
    const grid = (host: HTMLElement) => host.querySelector<HTMLElement>(".oe-grid")!.getAttribute("style") ?? "";
    const open = (thread: string) => ({ openThreadId: thread, openMessages: [{ summary: three().find((t) => t.threadId === thread)!.messages[0] }] });
    const doMove = (host: HTMLElement) => {
      const select = host.querySelector<HTMLSelectElement>('.oe-bulk-bar select[data-action="move"]')!;
      select.value = "P";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      flushSync();
    };
    const actions: Array<[string, (host: HTMLElement) => void]> = [
      ["Archive", (host) => click(action(host, "archive"))],
      ["Delete", (host) => click(action(host, "delete"))],
      ["Move", doMove],
    ];

    for (const [name, run] of actions) {
      it(`${name} collapses the pane when the open conversation is among the selection`, () => {
        const vm = withSelection(open("t2"));
        const { host, done } = mountApp(vm);
        expect(grid(host)).toContain("340px");
        run(host);
        expect(grid(host)).toMatch(/0px 0px;/);
        done();
      });

      it(`${name} leaves the pane open when the open conversation isn't selected`, () => {
        const vm = withSelection(open("t3"));
        const { host, done } = mountApp(vm);
        run(host);
        expect(grid(host)).toContain("340px");
        expect(grid(host)).not.toMatch(/0px 0px;/);
        done();
      });
    }

    it("the right-click menu's actions collapse it too", () => {
      const onBulkContextMenu = vi.fn();
      const vm = withSelection(open("t1"));
      const { host, done } = mountApp(vm, { onBulkContextMenu });
      rightClick(host.querySelectorAll(".oe-thread-row")[0]);
      const [, a] = onBulkContextMenu.mock.calls[0];
      a.onMove("P");
      flushSync();
      expect(grid(host)).toMatch(/0px 0px;/);
      done();
    });
  });

  it("right-clicking a row inside a multi-selection opens the bulk menu for the whole selection", () => {
    const onBulkContextMenu = vi.fn();
    const onThreadContextMenu = vi.fn();
    const vm = withSelection();
    const { host, done } = mountApp(vm, { onBulkContextMenu, onThreadContextMenu });
    rightClick(host.querySelectorAll(".oe-thread-row")[1]);
    expect(onThreadContextMenu).not.toHaveBeenCalled();
    const [, actions] = onBulkContextMenu.mock.calls[0];
    expect(actions.count).toBe(2);
    expect(actions.candidates.map((b: Mailbox) => b.id)).toEqual(["ARCHIVE", "P"]);
    expect(actions.showArchive).toBe(true);
    actions.onMarkUnread();
    expect(vm.markThreadsRead).toHaveBeenLastCalledWith(["t1", "t2"], false);
    actions.onMarkRead();
    expect(vm.markThreadsRead).toHaveBeenLastCalledWith(["t1", "t2"], true);
    actions.onMove("P");
    expect(vm.moveThreads).toHaveBeenCalledWith(["t1", "t2"], "P");
    actions.onArchive();
    expect(vm.archiveThreads).toHaveBeenCalledWith(["t1", "t2"]);
    actions.onDelete();
    expect(vm.deleteThreads).toHaveBeenCalledWith(["t1", "t2"]);
    done();
  });

  it("right-clicking a row outside the selection, or with a single row selected, opens the normal menu", () => {
    const onBulkContextMenu = vi.fn();
    const onThreadContextMenu = vi.fn();
    const multi = withSelection();
    const a = mountApp(multi, { onBulkContextMenu, onThreadContextMenu });
    rightClick(a.host.querySelectorAll(".oe-thread-row")[2]); // t3 isn't selected
    expect(onThreadContextMenu).toHaveBeenCalledOnce();
    a.done();
    const single = fakeVm({ threads: three(), selectedThreadIds: ["t1"] });
    const b = mountApp(single, { onBulkContextMenu, onThreadContextMenu });
    rightClick(b.host.querySelectorAll(".oe-thread-row")[0]);
    expect(onThreadContextMenu).toHaveBeenCalledTimes(2);
    expect(onBulkContextMenu).not.toHaveBeenCalled();
    b.done();
  });
});

describe("App — pinning", () => {
  const mountApp = (vm: ViewModel, over: object = {}) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(App, { target: host, props: appProps(vm, over) });
    flushSync();
    return { host, done: () => { unmount(app); host.remove(); } };
  };
  const click = (el: Element | null) => { (el as HTMLElement).click(); flushSync(); };
  const openMessages = [{
    summary: {
      id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
      to: [], cc: [], subject: "Hello", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: false,
    },
  }];

  it("the row Pin button toggles that thread", () => {
    const vm = fakeVm();
    const { host, done } = mountApp(vm);
    click(host.querySelector('.oe-thread-row [data-action="pin"]'));
    expect(vm.toggleThreadPin).toHaveBeenCalledWith("t1");
    done();
  });

  it("the ribbon Pin button toggles the open thread and shows pressed when it is pinned", () => {
    const vm = fakeVm({ openThreadId: "t1", openMessages, pinnedThreadIds: ["t1"] });
    const { host, done } = mountApp(vm);
    const btn = host.querySelector<HTMLElement>('.oe-ribbon [data-action="pin"]')!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    click(btn);
    expect(vm.toggleThreadPin).toHaveBeenCalledWith("t1");
    done();
  });

  it("the thread context menu receives pin state and a working toggle", () => {
    const onThreadContextMenu = vi.fn();
    const vm = fakeVm({ pinnedThreadIds: ["t1"] });
    const { host, done } = mountApp(vm, { onThreadContextMenu });
    host.querySelector(".oe-thread-row")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const [, actions] = onThreadContextMenu.mock.calls[0];
    expect(actions.pinned).toBe(true);
    actions.onTogglePin();
    expect(vm.toggleThreadPin).toHaveBeenCalledWith("t1");
    done();
  });
});

describe("App — Flagged view", () => {
  const mountApp = (vm: ViewModel, over: object = {}) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(App, { target: host, props: appProps(vm, over) });
    flushSync();
    return { host, done: () => { unmount(app); host.remove(); } };
  };
  const click = (el: Element | null) => { (el as HTMLElement).click(); flushSync(); };

  it("clicking Flagged selects the view", () => {
    const vm = fakeVm();
    const { host, done } = mountApp(vm);
    click(host.querySelector(".oe-mailbox-flagged"));
    expect(vm.selectFlagged).toHaveBeenCalledOnce();
    done();
  });

  it("selecting Flagged with an unsent message asks first", () => {
    const vm = fakeVm();
    (vm.hasUnsavedComposerContent as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const { host, done } = mountApp(vm);
    click(host.querySelector(".oe-mailbox-flagged"));
    expect(vm.selectFlagged).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();
    done();
  });

  it("while flagged is active only Flagged is highlighted and the empty state says so", () => {
    const vm = fakeVm({ flaggedActive: true, threads: [] });
    const { host, done } = mountApp(vm);
    expect(host.querySelectorAll(".oe-mailbox.is-active")).toHaveLength(1);
    expect(host.querySelector(".oe-mailbox-flagged")!.classList.contains("is-active")).toBe(true);
    expect(host.textContent).toContain("No flagged messages");
    done();
  });

  it("in the Flagged view Move offers every folder, including the one last active", () => {
    const onThreadContextMenu = vi.fn();
    const vm = fakeVm({ flaggedActive: true });
    const { host, done } = mountApp(vm, { onThreadContextMenu });
    host.querySelector(".oe-thread-row")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const [, actions] = onThreadContextMenu.mock.calls[0];
    expect(actions.candidates.map((m: { id: string }) => m.id)).toEqual(["INBOX"]);
    done();
  });

  it("in the Flagged view a row's Archive is offered (no active folder rules apply)", () => {
    const vm = fakeVm({ flaggedActive: true, mailboxes: [{ id: "DRAFTS", name: "Drafts", kind: "drafts" }], activeMailboxId: "DRAFTS" });
    const { host, done } = mountApp(vm);
    expect(host.querySelector('.oe-thread-row [data-action="archive"]')).not.toBeNull();
    done();
  });
});
