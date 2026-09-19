import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import ReadingPane from "../../src/view/components/ReadingPane.svelte";
import ReadingPaneHost from "./fixtures/ReadingPaneHost.svelte";
import type { ViewState } from "../../src/view/view-model";

const renderDeps = { getInlineAttachment: vi.fn(), openExternal: vi.fn() };

const msg = (id: string, subject: string): ViewState["openMessages"][number] => ({
  summary: {
    id, threadId: id.slice(0, 2), mailboxIds: ["INBOX"], from: { name: id, email: `${id}@x.com` },
    to: [], cc: [], subject, snippet: "", date: Date.now(), unread: false, hasAttachments: false, flagged: false,
  },
});

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
      props: { openMessages: open(), autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn() },
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
      target: host, props: { openMessages: [], autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn() },
    });
    flushSync();
    expect(host.textContent).toMatch(/select a message|nothing/i);
    unmount(app);
  });

  it("calls onDownload when an attachment chip is clicked", () => {
    const onDownload = vi.fn();
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host, props: { openMessages: open(), autoLoadImages: false, renderDeps, onClose: () => {}, onDownload },
    });
    flushSync();
    host.querySelector<HTMLElement>(".oe-attachment")!.click();
    expect(onDownload).toHaveBeenCalledWith("m1", expect.objectContaining({ filename: "report.pdf" }));
    unmount(app);
  });

  it("resets manual expansion when the open thread changes", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPaneHost, {
      target: host,
      props: {
        initial: [msg("aa1", "A one"), msg("aa2", "A two"), msg("aa3", "A three")],
        renderDeps, onClose: () => {}, onDownload: vi.fn(),
      },
    });
    flushSync();
    // Manually expand a non-last message in thread A.
    host.querySelectorAll<HTMLElement>(".oe-message-head")[1].click();
    flushSync();
    let expanded = host.querySelectorAll(".oe-message-block.is-expanded");
    expect(expanded.length).toBe(1);
    expect(expanded[0].textContent).toContain("aa2");

    // Swap to thread B — stale expandedId ("aa2") must not collapse every block.
    (app as unknown as { set: (m: ViewState["openMessages"]) => void }).set([msg("bb1", "B one"), msg("bb2", "B two")]);
    flushSync();
    expanded = host.querySelectorAll(".oe-message-block.is-expanded");
    expect(expanded.length).toBe(1);
    expect(expanded[0].textContent).toContain("bb2");
    unmount(app);
  });

  it("does not toggle expansion when the header click ends a text selection", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPaneHost, {
      target: host,
      props: {
        initial: [msg("aa1", "A one"), msg("aa2", "A two")],
        renderDeps, onClose: () => {}, onDownload: vi.fn(),
      },
    });
    flushSync();
    // Manually expand the non-last message.
    const heads = host.querySelectorAll<HTMLElement>(".oe-message-head");
    heads[0].click();
    flushSync();
    expect(host.querySelector(".oe-message-block.is-expanded")?.textContent).toContain("aa1");

    // Ending a drag-selection on that same header must not collapse it.
    const selectionSpy = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "some selected text",
    } as Selection);
    try {
      heads[0].click();
      flushSync();
      expect(host.querySelector(".oe-message-block.is-expanded")?.textContent).toContain("aa1");

      // A plain click (no active selection) still toggles normally — falls
      // back to the last message expanding instead.
      selectionSpy.mockReturnValue({ toString: () => "" } as Selection);
      heads[0].click();
      flushSync();
      expect(host.querySelector(".oe-message-block.is-expanded")?.textContent).toContain("aa2");
    } finally {
      // A failed assertion above must not leak this spy into later tests.
      selectionSpy.mockRestore();
    }
    unmount(app);
  });

  it("toggles expansion on Enter or Space, matching its ARIA button role", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPaneHost, {
      target: host,
      props: {
        initial: [msg("aa1", "A one"), msg("aa2", "A two")],
        renderDeps, onClose: () => {}, onDownload: vi.fn(),
      },
    });
    flushSync();
    const head = host.querySelectorAll<HTMLElement>(".oe-message-head")[0];

    head.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    flushSync();
    expect(host.querySelector(".oe-message-block.is-expanded")?.textContent).toContain("aa1");

    const spaceEvent = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    head.dispatchEvent(spaceEvent);
    flushSync();
    // Falls back to the last message expanding instead — Space toggled it shut.
    expect(host.querySelector(".oe-message-block.is-expanded")?.textContent).toContain("aa2");
    expect(spaceEvent.defaultPrevented).toBe(true);

    unmount(app);
  });

  it("renders a Load remote images button for blocked content", () => {
    const host = document.createElement("div");
    const msgs = open();
    msgs[0].body!.html = '<img src="https://tracker.example/p.gif">';
    const app = mount(ReadingPane, {
      target: host, props: { openMessages: msgs, autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn() },
    });
    flushSync();
    expect(host.textContent).toMatch(/load remote images/i);
    unmount(app);
  });

  it("honours autoLoadImages: renders remote images with no banner", () => {
    const host = document.createElement("div");
    const msgs = open();
    msgs[0].body!.html = '<img src="https://cdn.example/p.gif">';
    const app = mount(ReadingPane, {
      target: host, props: { openMessages: msgs, autoLoadImages: true, renderDeps, onClose: () => {}, onDownload: vi.fn() },
    });
    flushSync();
    expect(host.textContent).not.toMatch(/load remote images/i);
    expect(host.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/p.gif");
    unmount(app);
  });
});

describe("ReadingPane — composer rendering", () => {
  const composerProps = {
    to: [], cc: [], bcc: [], subject: "", bodyHtml: "", attachments: [], error: null,
    onFieldsChange: vi.fn(), onBodyChange: vi.fn(), onRemoveAttachment: vi.fn(),
  };

  it("renders the Composer inline under the message being replied to", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host,
      props: {
        openMessages: open(), autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn(),
        activeComposerMessageId: "m1", composerMode: "reply", composerProps,
      },
    });
    flushSync();
    expect(host.querySelector(".oe-composer")).not.toBeNull();
    unmount(app);
  });

  it("renders a top-level Composer for mode=new/editDraft instead of the empty state", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host,
      props: {
        openMessages: [], autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn(),
        activeComposerMessageId: null, composerMode: "new", composerProps,
      },
    });
    flushSync();
    expect(host.querySelector(".oe-composer")).not.toBeNull();
    expect(host.textContent).not.toMatch(/select a message/i);
    unmount(app);
  });
});
