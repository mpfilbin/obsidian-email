import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import App from "../../src/view/App.svelte";
import type { ViewModel, ViewState } from "../../src/view/view-model";

function fakeVm(state: Partial<ViewState> = {}): ViewModel {
  const full: ViewState = {
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
    ...state,
  };
  return {
    getState: () => full,
    subscribe: (fn: (s: ViewState) => void) => { fn(full); return () => {}; },
    selectAccount: vi.fn(), selectMailbox: vi.fn(), openThread: vi.fn(), closeThread: vi.fn(),
    loadMore: vi.fn(), refresh: vi.fn(), runSearch: vi.fn(), clearSearch: vi.fn(),
    renderDeps: () => ({ getInlineAttachment: async () => undefined, openExternal: () => {} }),
    downloadAttachment: vi.fn(), downloadAttachmentToDisk: vi.fn(),
  } as unknown as ViewModel;
}

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
