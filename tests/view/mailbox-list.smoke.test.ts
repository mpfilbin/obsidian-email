import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import MailboxList from "../../src/view/components/MailboxList.svelte";
import type { Mailbox } from "../../src/providers/types";

const mailboxes: Mailbox[] = [
  { id: "INBOX", name: "Inbox", kind: "inbox", unreadCount: 3 },
  { id: "SENT", name: "Sent", kind: "sent" },
  { id: "TRASH", name: "Deleted Items", kind: "trash" },
  { id: "LBL1", name: "Projects", kind: "custom" },
];

describe("MailboxList smoke", () => {
  it("renders a distinct icon per mailbox kind", () => {
    const host = document.createElement("div");
    const app = mount(MailboxList, {
      target: host,
      props: { mailboxes, activeId: "INBOX", onSelect: vi.fn() },
    });
    flushSync();
    const icons = [...host.querySelectorAll(".oe-mailbox-icon")].map((el) => el.getAttribute("data-icon"));
    expect(icons).toEqual(["inbox", "send", "trash-2", "folder"]);
    unmount(app);
  });

  it("calls onSelect with the clicked mailbox id", () => {
    const onSelect = vi.fn();
    const host = document.createElement("div");
    const app = mount(MailboxList, { target: host, props: { mailboxes, activeId: "INBOX", onSelect } });
    [...host.querySelectorAll(".oe-mailbox")][1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith("SENT");
    unmount(app);
  });
});
