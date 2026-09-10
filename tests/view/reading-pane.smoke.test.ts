import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import ReadingPane from "../../src/view/components/ReadingPane.svelte";
import type { ViewState } from "../../src/view/view-model";

const renderDeps = { getInlineAttachment: vi.fn(), openExternal: vi.fn() };

const open = (): ViewState["openMessages"] => [{
  summary: {
    id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
    to: [{ email: "me@x.com" }], cc: [], subject: "Hello", snippet: "", date: Date.now(),
    unread: false, hasAttachments: true, flagged: false,
  },
  body: {
    id: "m1", html: "<p>Body <b>text</b></p>", text: null, headers: {},
    attachments: [{ id: "a1", filename: "report.pdf", mimeType: "application/pdf", size: 10, inline: false }],
  },
}];

describe("ReadingPane smoke", () => {
  it("renders the subject, sanitized body and an attachment chip", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host,
      props: { openMessages: open(), renderDeps, onClose: () => {}, onDownload: vi.fn() },
    });
    flushSync();
    expect(host.textContent).toContain("Hello");
    expect(host.querySelector(".obsidian-email-message-body b")?.textContent).toBe("text");
    expect(host.textContent).toContain("report.pdf");
    unmount(app);
  });

  it("shows an empty state with no open thread", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host, props: { openMessages: [], renderDeps, onClose: () => {}, onDownload: vi.fn() },
    });
    flushSync();
    expect(host.textContent).toMatch(/select a message|nothing/i);
    unmount(app);
  });

  it("calls onDownload when an attachment chip is clicked", () => {
    const onDownload = vi.fn();
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host, props: { openMessages: open(), renderDeps, onClose: () => {}, onDownload },
    });
    flushSync();
    host.querySelector<HTMLElement>(".oe-attachment")!.click();
    expect(onDownload).toHaveBeenCalledWith("m1", expect.objectContaining({ filename: "report.pdf" }));
    unmount(app);
  });

  it("renders a Load remote images button for blocked content", () => {
    const host = document.createElement("div");
    const msgs = open();
    msgs[0].body!.html = '<img src="https://tracker.example/p.gif">';
    const app = mount(ReadingPane, {
      target: host, props: { openMessages: msgs, renderDeps, onClose: () => {}, onDownload: vi.fn() },
    });
    flushSync();
    expect(host.textContent).toMatch(/load remote images/i);
    unmount(app);
  });
});
