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
    onArchive: vi.fn(), onDelete: vi.fn(), onTogglePin: vi.fn(), onContextMenu: vi.fn(),
    ...over,
  };
}

describe("ThreadRow smoke", () => {
  it("shows a due badge on a flagged thread, and marks overdue ones", () => {
    const withDue = (flagDue: number, flagged = true): ThreadView => ({
      ...thread, flagged, flagDue,
      messages: [{ ...thread.messages[0], flagged, flagDue }],
    });
    const host = document.createElement("div");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const app = mount(ThreadRow, { target: host, props: baseProps({ thread: withDue(today.getTime()) }) });
    flushSync();
    expect(host.querySelector(".oe-flag-due")?.textContent).toBe("Due today");
    expect(host.querySelector(".oe-flag-due")?.classList.contains("is-overdue")).toBe(false);
    unmount(app);

    const host2 = document.createElement("div");
    const app2 = mount(ThreadRow, { target: host2, props: baseProps({ thread: withDue(today.getTime() - 3 * 86_400_000) }) });
    flushSync();
    expect(host2.querySelector(".oe-flag-due")?.textContent).toBe("Overdue");
    expect(host2.querySelector(".oe-flag-due")?.classList.contains("is-overdue")).toBe(true);
    unmount(app2);
  });

  it("shows no due badge for an undated or unflagged thread", () => {
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps() });
    flushSync();
    expect(host.querySelector(".oe-flag-due")).toBeNull();
    unmount(app);
  });

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

describe("ThreadRow flagging", () => {
  const flaggedThread: ThreadView = {
    ...thread, flagged: true,
    messages: [{ ...thread.messages[0], flagged: true }],
  };

  it("shows a Flag button that reports the toggle without opening the thread", () => {
    const onToggleFlag = vi.fn(); const onOpen = vi.fn();
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ onToggleFlag, onOpen }) });
    flushSync();
    const btn = host.querySelector<HTMLButtonElement>('[data-action="flag"]')!;
    expect(btn.textContent).toContain("Flag");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    btn.click();
    expect(onToggleFlag).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-flag")).toBeNull();
    unmount(app);
  });

  it("a flagged thread shows the indicator and an Unflag button", () => {
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ thread: flaggedThread, onToggleFlag: vi.fn() }) });
    flushSync();
    expect(host.querySelector(".oe-flag")).not.toBeNull();
    const btn = host.querySelector<HTMLButtonElement>('[data-action="flag"]')!;
    expect(btn.textContent).toContain("Unflag");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    unmount(app);
  });

  it("the indicator shows when only one of several messages is flagged", () => {
    const two: ThreadView = {
      ...thread,
      messages: [thread.messages[0], { ...thread.messages[0], id: "m2", flagged: true }],
    };
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ thread: two }) });
    flushSync();
    expect(host.querySelector(".oe-flag")).not.toBeNull();
    unmount(app);
  });

  it("Enter on a row action button does not open the thread, but Enter on the row does", () => {
    const onOpen = vi.fn();
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ onOpen, onToggleFlag: vi.fn(), onTogglePin: vi.fn() }) });
    flushSync();
    const enter = () => new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    for (const action of ["flag", "pin", "archive", "delete"]) {
      host.querySelector(`[data-action="${action}"]`)!.dispatchEvent(enter());
      expect(onOpen, action).not.toHaveBeenCalled();
    }
    host.querySelector(".oe-thread-row")!.dispatchEvent(enter());
    expect(onOpen).toHaveBeenCalledOnce();
    unmount(app);
  });
});

describe("ThreadRow pinning", () => {
  const pinnedThread: ThreadView = { ...thread, pinned: true };

  it("shows a Pin button that reports the toggle without opening the thread", () => {
    const onTogglePin = vi.fn(); const onOpen = vi.fn();
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ onTogglePin, onOpen }) });
    flushSync();
    const btn = host.querySelector<HTMLButtonElement>('[data-action="pin"]')!;
    expect(btn.textContent).toContain("Pin");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    btn.click();
    expect(onTogglePin).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-pin")).toBeNull();
    expect(host.querySelector(".oe-thread-row")!.classList.contains("is-pinned")).toBe(false);
    unmount(app);
  });

  it("a pinned thread shows the indicator, the accent class and an Unpin button", () => {
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ thread: pinnedThread, onTogglePin: vi.fn() }) });
    flushSync();
    expect(host.querySelector(".oe-pin")).not.toBeNull();
    expect(host.querySelector(".oe-thread-row")!.classList.contains("is-pinned")).toBe(true);
    const btn = host.querySelector<HTMLButtonElement>('[data-action="pin"]')!;
    expect(btn.textContent).toContain("Unpin");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    unmount(app);
  });
});

describe("ThreadRow multi-select", () => {
  const mountRow = (over: Record<string, unknown> = {}) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const props = baseProps({ onSelect: vi.fn(), ...over });
    const app = mount(ThreadRow, { target: host, props });
    flushSync();
    const row = host.querySelector<HTMLElement>(".oe-thread-row")!;
    return { host, row, props: props as ReturnType<typeof baseProps> & { onSelect: ReturnType<typeof vi.fn> }, done: () => { unmount(app); host.remove(); } };
  };
  const click = (el: Element, init: MouseEventInit = {}) => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init })); flushSync(); };

  it("has a labelled checkbox that reflects `selected`", () => {
    const a = mountRow();
    const box = a.host.querySelector<HTMLInputElement>(".oe-row-check")!;
    expect(box.type).toBe("checkbox");
    expect(box.getAttribute("aria-label")).toBe("Select conversation: Hello");
    expect(box.checked).toBe(false);
    expect(a.row.classList.contains("is-selected")).toBe(false);
    a.done();
    const b = mountRow({ selected: true });
    expect(b.host.querySelector<HTMLInputElement>(".oe-row-check")!.checked).toBe(true);
    expect(b.row.classList.contains("is-selected")).toBe(true);
    b.done();
  });

  it("marks every row when any row is ticked", () => {
    const a = mountRow({ selectionActive: true });
    expect(a.row.classList.contains("selection-active")).toBe(true);
    a.done();
    const b = mountRow();
    expect(b.row.classList.contains("selection-active")).toBe(false);
    b.done();
  });

  it("clicking the checkbox toggles the row without opening it", () => {
    const a = mountRow();
    click(a.host.querySelector(".oe-row-check")!);
    expect(a.props.onSelect).toHaveBeenCalledWith("toggle");
    expect(a.props.onOpen).not.toHaveBeenCalled();
    a.done();
  });

  it("shift-clicking the checkbox ticks a range", () => {
    const a = mountRow();
    click(a.host.querySelector(".oe-row-check")!, { shiftKey: true });
    expect(a.props.onSelect).toHaveBeenCalledWith("range");
    expect(a.props.onOpen).not.toHaveBeenCalled();
    a.done();
  });

  it("Ctrl-click and Cmd-click on the row toggle it instead of opening it", () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      const a = mountRow();
      click(a.row, mod);
      expect(a.props.onSelect).toHaveBeenCalledWith("toggle");
      expect(a.props.onOpen).not.toHaveBeenCalled();
      a.done();
    }
  });

  it("Shift-click on the row ticks a range instead of opening it", () => {
    const a = mountRow();
    click(a.row, { shiftKey: true });
    expect(a.props.onSelect).toHaveBeenCalledWith("range");
    expect(a.props.onOpen).not.toHaveBeenCalled();
    a.done();
  });

  it("a plain click still opens the row and selects nothing", () => {
    const a = mountRow();
    click(a.row);
    expect(a.props.onOpen).toHaveBeenCalledOnce();
    expect(a.props.onSelect).not.toHaveBeenCalled();
    a.done();
  });

  it("Space toggles the row (and is not left to scroll the list); Enter opens it", () => {
    const a = mountRow();
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    a.row.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    expect(a.props.onSelect).toHaveBeenCalledWith("toggle");
    a.row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(a.props.onOpen).toHaveBeenCalledOnce();
    a.done();
  });

  it("ignores keys that aren't Enter or Space", () => {
    const a = mountRow();
    for (const key of ["a", "Tab", "ArrowDown", "Escape"]) {
      a.row.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    expect(a.props.onSelect).not.toHaveBeenCalled();
    expect(a.props.onOpen).not.toHaveBeenCalled();
    a.done();
  });

  it("a Shift-mousedown doesn't start a text selection across rows", () => {
    const a = mountRow();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, shiftKey: true });
    a.row.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    const plain = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    a.row.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    a.done();
  });
});
