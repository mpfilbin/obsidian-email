import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import MailboxList from "../../src/view/components/MailboxList.svelte";
import { THREAD_DRAG_TYPE } from "../../src/view/drag-types";
import type { Mailbox } from "../../src/providers/types";

const mailboxes: Mailbox[] = [
  { id: "INBOX", name: "Inbox", kind: "inbox", unreadCount: 3 },
  { id: "SENT", name: "Sent", kind: "sent" },
  { id: "TRASH", name: "Deleted Items", kind: "trash" },
  { id: "LBL1", name: "Projects", kind: "custom" },
];

function dragEvent(type: string, dataTransfer: Record<string, unknown>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
}

describe("MailboxList smoke", () => {
  it("renders a distinct icon per mailbox kind", () => {
    const host = document.createElement("div");
    const app = mount(MailboxList, {
      target: host,
      props: { mailboxes, activeId: "INBOX", onSelect: vi.fn(), onDropThread: vi.fn() },
    });
    flushSync();
    const icons = [...host.querySelectorAll(".oe-mailbox:not(.oe-mailbox-flagged) .oe-mailbox-icon")].map((el) => el.getAttribute("data-icon"));
    expect(icons).toEqual(["inbox", "send", "trash-2", "folder"]);
    unmount(app);
  });

  it("calls onSelect with the clicked mailbox id", () => {
    const onSelect = vi.fn();
    const host = document.createElement("div");
    const app = mount(MailboxList, { target: host, props: { mailboxes, activeId: "INBOX", onSelect, onDropThread: vi.fn() } });
    [...host.querySelectorAll(".oe-mailbox:not(.oe-mailbox-flagged)")][1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith("SENT");
    unmount(app);
  });

  it("allows dragging a thread over a different mailbox and shows the drag-over state", () => {
    const host = document.createElement("div");
    const app = mount(MailboxList, { target: host, props: { mailboxes, activeId: "INBOX", onSelect: vi.fn(), onDropThread: vi.fn() } });
    flushSync();
    const sentRow = [...host.querySelectorAll<HTMLElement>(".oe-mailbox:not(.oe-mailbox-flagged)")][1];
    const event = dragEvent("dragover", { types: [THREAD_DRAG_TYPE] });
    const preventSpy = vi.spyOn(event, "preventDefault");
    sentRow.dispatchEvent(event);
    flushSync();
    expect(preventSpy).toHaveBeenCalled();
    expect(sentRow.classList.contains("is-drag-over")).toBe(true);
    unmount(app);
  });

  it("refuses to allow dropping a thread onto the currently active mailbox", () => {
    const host = document.createElement("div");
    const app = mount(MailboxList, { target: host, props: { mailboxes, activeId: "INBOX", onSelect: vi.fn(), onDropThread: vi.fn() } });
    flushSync();
    const inboxRow = [...host.querySelectorAll<HTMLElement>(".oe-mailbox:not(.oe-mailbox-flagged)")][0];
    const event = dragEvent("dragover", { types: [THREAD_DRAG_TYPE] });
    const preventSpy = vi.spyOn(event, "preventDefault");
    inboxRow.dispatchEvent(event);
    expect(preventSpy).not.toHaveBeenCalled();
    unmount(app);
  });

  it("ignores a drag whose payload isn't a thread (e.g. an OS file drop)", () => {
    const host = document.createElement("div");
    const app = mount(MailboxList, { target: host, props: { mailboxes, activeId: "INBOX", onSelect: vi.fn(), onDropThread: vi.fn() } });
    flushSync();
    const sentRow = [...host.querySelectorAll<HTMLElement>(".oe-mailbox:not(.oe-mailbox-flagged)")][1];
    const event = dragEvent("dragover", { types: ["Files"] });
    const preventSpy = vi.spyOn(event, "preventDefault");
    sentRow.dispatchEvent(event);
    expect(preventSpy).not.toHaveBeenCalled();
    unmount(app);
  });

  it("dropping a thread onto a mailbox calls onDropThread with the thread id and target mailbox", () => {
    const onDropThread = vi.fn();
    const host = document.createElement("div");
    const app = mount(MailboxList, { target: host, props: { mailboxes, activeId: "INBOX", onSelect: vi.fn(), onDropThread } });
    flushSync();
    const sentRow = [...host.querySelectorAll<HTMLElement>(".oe-mailbox:not(.oe-mailbox-flagged)")][1];
    const event = dragEvent("drop", { types: [THREAD_DRAG_TYPE], getData: () => "t1" });
    sentRow.dispatchEvent(event);
    expect(onDropThread).toHaveBeenCalledWith("t1", "SENT");
    unmount(app);
  });

  it("dropping onto the currently active mailbox does not call onDropThread", () => {
    const onDropThread = vi.fn();
    const host = document.createElement("div");
    const app = mount(MailboxList, { target: host, props: { mailboxes, activeId: "INBOX", onSelect: vi.fn(), onDropThread } });
    flushSync();
    const inboxRow = [...host.querySelectorAll<HTMLElement>(".oe-mailbox:not(.oe-mailbox-flagged)")][0];
    const event = dragEvent("drop", { types: [THREAD_DRAG_TYPE], getData: () => "t1" });
    inboxRow.dispatchEvent(event);
    expect(onDropThread).not.toHaveBeenCalled();
    unmount(app);
  });

  it("right-clicking a custom folder calls onContextMenu and suppresses the native menu", () => {
    const onContextMenu = vi.fn();
    const host = document.createElement("div");
    const app = mount(MailboxList, {
      target: host,
      props: { mailboxes, activeId: "INBOX", onSelect: vi.fn(), onDropThread: vi.fn(), onContextMenu },
    });
    flushSync();
    const projectsRow = [...host.querySelectorAll<HTMLElement>(".oe-mailbox:not(.oe-mailbox-flagged)")][3]; // LBL1, kind: custom
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(event, "preventDefault");
    projectsRow.dispatchEvent(event);
    expect(preventSpy).toHaveBeenCalled();
    expect(onContextMenu).toHaveBeenCalledWith(event, "LBL1");
    unmount(app);
  });

  it("right-clicking a built-in folder does not call onContextMenu — Graph doesn't allow renaming those", () => {
    const onContextMenu = vi.fn();
    const host = document.createElement("div");
    const app = mount(MailboxList, {
      target: host,
      props: { mailboxes, activeId: "INBOX", onSelect: vi.fn(), onDropThread: vi.fn(), onContextMenu },
    });
    flushSync();
    const inboxRow = [...host.querySelectorAll<HTMLElement>(".oe-mailbox:not(.oe-mailbox-flagged)")][0];
    inboxRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(onContextMenu).not.toHaveBeenCalled();
    unmount(app);
  });
});

describe("MailboxList Flagged entry", () => {
  const props = (over: Record<string, unknown> = {}) => ({
    mailboxes, activeId: "INBOX", flaggedActive: false,
    onSelect: vi.fn(), onSelectFlagged: vi.fn(), onDropThread: vi.fn(), ...over,
  });

  it("renders Flagged first, with the flag icon, and reports a click", () => {
    const onSelectFlagged = vi.fn();
    const host = document.createElement("div");
    const app = mount(MailboxList, { target: host, props: props({ onSelectFlagged }) });
    flushSync();
    const first = host.querySelector<HTMLElement>(".oe-mailbox")!;
    expect(first.classList.contains("oe-mailbox-flagged")).toBe(true);
    expect(first.textContent).toContain("Flagged");
    expect(first.querySelector(".oe-mailbox-icon")!.getAttribute("data-icon")).toBe("flag");
    first.click();
    expect(onSelectFlagged).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("is active only while flaggedActive (the page passes no active mailbox then)", () => {
    const host = document.createElement("div");
    const app = mount(MailboxList, { target: host, props: props({ flaggedActive: true, activeId: null }) });
    flushSync();
    expect(host.querySelector(".oe-mailbox-flagged")!.classList.contains("is-active")).toBe(true);
    expect(host.querySelectorAll(".oe-mailbox.is-active")).toHaveLength(1);
    unmount(app);
  });

  it("is not a drop target for dragged threads", () => {
    const onDropThread = vi.fn();
    const host = document.createElement("div");
    const app = mount(MailboxList, { target: host, props: props({ onDropThread }) });
    flushSync();
    const flagged = host.querySelector(".oe-mailbox-flagged")!;
    const over = dragEvent("dragover", { types: [THREAD_DRAG_TYPE], getData: () => "t1" });
    flagged.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    flagged.dispatchEvent(dragEvent("drop", { types: [THREAD_DRAG_TYPE], getData: () => "t1" }));
    expect(onDropThread).not.toHaveBeenCalled();
    unmount(app);
  });
});
