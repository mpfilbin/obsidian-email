import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import MessageList from "../../src/view/components/MessageList.svelte";
import type { ThreadView } from "../../src/view/view-model";

const thread = (id: string, over: Partial<ThreadView> = {}): ThreadView => ({
  threadId: id, subject: `Subject ${id}`, lastDate: Date.now(), unread: true,
  messages: [{
    id: `${id}-a`, threadId: id, mailboxIds: ["INBOX"], from: { name: "Alice", email: "a@x.com" },
    to: [], cc: [], subject: `Subject ${id}`, snippet: "preview text", date: Date.now(),
    unread: true, hasAttachments: true, flagged: false,
  }],
  ...over,
});

describe("MessageList smoke", () => {
  it("renders rows and calls onOpen on click", () => {
    const onOpen = vi.fn();
    const host = document.createElement("div");
    const app = mount(MessageList, {
      target: host,
      props: { threads: [thread("t1")], openThreadId: null, hasMore: false, loading: false, onOpen, onLoadMore: () => {} },
    });
    expect(host.textContent).toContain("Subject t1");
    expect(host.textContent).toContain("Alice");
    host.querySelector<HTMLElement>(".oe-thread-row")!.click();
    expect(onOpen).toHaveBeenCalledWith("t1");
    unmount(app);
  });

  it("shows an empty state", () => {
    const host = document.createElement("div");
    const app = mount(MessageList, {
      target: host,
      props: { threads: [], openThreadId: null, hasMore: false, loading: false, onOpen: () => {}, onLoadMore: () => {} },
    });
    expect(host.textContent).toMatch(/no messages/i);
    unmount(app);
  });

  it("threads mailbox-kind flags and archive/delete callbacks down to each ThreadRow", () => {
    const onArchiveThread = vi.fn();
    const onDeleteThread = vi.fn();
    const host = document.createElement("div");
    const app = mount(MessageList, {
      target: host,
      props: {
        threads: [{
          threadId: "t1", subject: "Hi", lastDate: 1, unread: false,
          messages: [{ id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { email: "a@x.com" }, to: [], cc: [],
            subject: "Hi", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: false }],
        }],
        openThreadId: null, hasMore: false, loading: false, onOpen: vi.fn(), onLoadMore: vi.fn(),
        isDraftsMailbox: false, isArchiveMailbox: false, isTrashMailbox: false,
        onArchiveThread, onDeleteThread,
      },
    });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="archive"]')!.click();
    expect(onArchiveThread).toHaveBeenCalledWith("t1");
    host.querySelector<HTMLElement>('[data-action="delete"]')!.click();
    expect(onDeleteThread).toHaveBeenCalledWith("t1");
    unmount(app);
  });

  it("passes the thread id to onToggleFlag", () => {
    const onToggleFlag = vi.fn();
    const host = document.createElement("div");
    const app = mount(MessageList, {
      target: host,
      props: { threads: [thread("t1")], openThreadId: null, hasMore: false, loading: false, onOpen: () => {}, onLoadMore: () => {}, onToggleFlag },
    });
    host.querySelector<HTMLElement>('[data-action="flag"]')!.click();
    expect(onToggleFlag).toHaveBeenCalledWith("t1");
    unmount(app);
  });

  it("passes the thread id to onTogglePin", () => {
    const onTogglePin = vi.fn();
    const host = document.createElement("div");
    const app = mount(MessageList, {
      target: host,
      props: { threads: [thread("t1")], openThreadId: null, hasMore: false, loading: false, onOpen: () => {}, onLoadMore: () => {}, onTogglePin },
    });
    host.querySelector<HTMLElement>('[data-action="pin"]')!.click();
    expect(onTogglePin).toHaveBeenCalledWith("t1");
    unmount(app);
  });

  it("uses the given empty text", () => {
    const host = document.createElement("div");
    const app = mount(MessageList, {
      target: host,
      props: { threads: [], openThreadId: null, hasMore: false, loading: false, onOpen: () => {}, onLoadMore: () => {}, emptyText: "No flagged messages" },
    });
    expect(host.textContent).toContain("No flagged messages");
    unmount(app);
  });

  it("marks the selected rows, shows every checkbox once anything is ticked, and reports row selection", () => {
    const onSelectThread = vi.fn();
    const host = document.createElement("div");
    const app = mount(MessageList, {
      target: host,
      props: {
        threads: [thread("t1"), thread("t2")], openThreadId: null, hasMore: false, loading: false,
        onOpen: () => {}, onLoadMore: () => {}, selectedIds: ["t2"], onSelectThread,
      },
    });
    flushSync();
    const rows = host.querySelectorAll<HTMLElement>(".oe-thread-row");
    expect([...rows].map((r) => r.classList.contains("is-selected"))).toEqual([false, true]);
    expect([...rows].every((r) => r.classList.contains("selection-active"))).toBe(true);
    host.querySelector<HTMLElement>(".oe-thread-row")!.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    expect(onSelectThread).toHaveBeenCalledWith("t1", "toggle");
    rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    expect(onSelectThread).toHaveBeenCalledWith("t2", "range");
    unmount(app);
  });

  it("shows no selection chrome when nothing is selected", () => {
    const host = document.createElement("div");
    const app = mount(MessageList, {
      target: host,
      props: { threads: [thread("t1")], openThreadId: null, hasMore: false, loading: false, onOpen: () => {}, onLoadMore: () => {} },
    });
    flushSync();
    const row = host.querySelector<HTMLElement>(".oe-thread-row")!;
    expect(row.classList.contains("is-selected")).toBe(false);
    expect(row.classList.contains("selection-active")).toBe(false);
    unmount(app);
  });
});

