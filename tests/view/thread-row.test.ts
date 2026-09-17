import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import ThreadRow from "../../src/view/components/ThreadRow.svelte";
import type { ThreadView } from "../../src/view/view-model";

const thread: ThreadView = {
  threadId: "t1", subject: "Hello", lastDate: Date.now(), unread: false,
  messages: [{
    id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
    to: [], cc: [], subject: "Hello", snippet: "hi", date: Date.now(),
    unread: false, hasAttachments: false, flagged: false,
  }],
};

function baseProps(over: Partial<Record<string, unknown>> = {}) {
  return {
    thread, isOpen: false, onOpen: vi.fn(),
    isDraftsMailbox: false, isArchiveMailbox: false, isTrashMailbox: false,
    onArchive: vi.fn(), onDelete: vi.fn(), onContextMenu: vi.fn(),
    ...over,
  };
}

describe("ThreadRow smoke", () => {
  it("shows Archive and Delete in a normal mailbox", () => {
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps() });
    flushSync();
    expect(host.querySelector('[data-action="archive"]')).not.toBeNull();
    expect(host.querySelector('[data-action="delete"]')).not.toBeNull();
    unmount(app);
  });

  it("hides Archive in Drafts, Archive, and Trash but always shows Delete", () => {
    for (const flags of [
      { isDraftsMailbox: true }, { isArchiveMailbox: true }, { isTrashMailbox: true },
    ]) {
      const host = document.createElement("div");
      const app = mount(ThreadRow, { target: host, props: baseProps(flags) });
      flushSync();
      expect(host.querySelector('[data-action="archive"]')).toBeNull();
      expect(host.querySelector('[data-action="delete"]')).not.toBeNull();
      unmount(app);
    }
  });

  it("clicking Archive calls onArchive without triggering onOpen", () => {
    const onArchive = vi.fn();
    const onOpen = vi.fn();
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ onArchive, onOpen }) });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="archive"]')!.click();
    expect(onArchive).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    unmount(app);
  });

  it("clicking Delete calls onDelete without triggering onOpen", () => {
    const onDelete = vi.fn();
    const onOpen = vi.fn();
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ onDelete, onOpen }) });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="delete"]')!.click();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    unmount(app);
  });

  it("clicking the row itself still calls onOpen", () => {
    const onOpen = vi.fn();
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ onOpen }) });
    flushSync();
    host.querySelector<HTMLElement>(".oe-thread-row")!.click();
    expect(onOpen).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("is draggable and puts the thread id on the drag payload under the custom MIME type", () => {
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps() });
    flushSync();
    const row = host.querySelector<HTMLElement>(".oe-thread-row")!;
    expect(row.getAttribute("draggable")).toBe("true");

    const setData = vi.fn();
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { setData } });
    row.dispatchEvent(event);
    expect(setData).toHaveBeenCalledWith("application/x-oe-thread-id", "t1");
    unmount(app);
  });

  it("right-clicking calls onContextMenu and suppresses the native menu", () => {
    const onContextMenu = vi.fn();
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ onContextMenu }) });
    flushSync();
    const row = host.querySelector<HTMLElement>(".oe-thread-row")!;
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(event, "preventDefault");
    row.dispatchEvent(event);
    expect(preventSpy).toHaveBeenCalled();
    expect(onContextMenu).toHaveBeenCalledWith(event);
    unmount(app);
  });
});
