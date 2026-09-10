import { describe, it, expect, vi } from "vitest";
import { mount, unmount } from "svelte";
import App from "../../src/view/App.svelte";
import type { ViewModel, ViewState } from "../../src/view/view-model";

function fakeVm(state: Partial<ViewState> = {}): ViewModel {
  const full: ViewState = {
    accounts: [{ id: "a1", email: "a1@x.com", provider: "gmail", status: "idle" }],
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
    hasMore: false, loadingList: false,
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
});
