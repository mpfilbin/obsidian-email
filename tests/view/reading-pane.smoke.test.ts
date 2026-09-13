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

describe("ReadingPane — reply/forward/edit actions", () => {
  const composerProps = {
    to: [], cc: [], bcc: [], subject: "", bodyHtml: "", sending: false, error: null,
    onFieldsChange: vi.fn(), onBodyChange: vi.fn(), onSend: vi.fn(), onSaveDraft: vi.fn(), onDiscard: vi.fn(),
  };

  it("shows Reply/Reply all/Forward buttons on a message when not in the Drafts mailbox", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host,
      props: {
        openMessages: open(), autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn(),
        isDraftsMailbox: false, activeComposerMessageId: null, composerMode: null, composerProps: null,
        onOpenReply: vi.fn(), onOpenForward: vi.fn(), onEditDraft: vi.fn(),
      },
    });
    flushSync();
    expect(host.querySelector('[data-action="reply"]')).not.toBeNull();
    expect(host.querySelector('[data-action="reply-all"]')).not.toBeNull();
    expect(host.querySelector('[data-action="forward"]')).not.toBeNull();
    expect(host.querySelector('[data-action="edit-draft"]')).toBeNull();
    unmount(app);
  });

  it("shows an Edit button instead, in the Drafts mailbox", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host,
      props: {
        openMessages: open(), autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn(),
        isDraftsMailbox: true, activeComposerMessageId: null, composerMode: null, composerProps: null,
        onOpenReply: vi.fn(), onOpenForward: vi.fn(), onEditDraft: vi.fn(),
      },
    });
    flushSync();
    expect(host.querySelector('[data-action="reply"]')).toBeNull();
    expect(host.querySelector('[data-action="edit-draft"]')).not.toBeNull();
    unmount(app);
  });

  it("clicking Reply calls onOpenReply(m1, 'reply')", () => {
    const onOpenReply = vi.fn();
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host,
      props: {
        openMessages: open(), autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn(),
        isDraftsMailbox: false, activeComposerMessageId: null, composerMode: null, composerProps: null,
        onOpenReply, onOpenForward: vi.fn(), onEditDraft: vi.fn(),
      },
    });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="reply"]')!.click();
    expect(onOpenReply).toHaveBeenCalledWith("m1", "reply");
    unmount(app);
  });

  it("renders the Composer inline under the message being replied to", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host,
      props: {
        openMessages: open(), autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn(),
        isDraftsMailbox: false, activeComposerMessageId: "m1", composerMode: "reply", composerProps,
        onOpenReply: vi.fn(), onOpenForward: vi.fn(), onEditDraft: vi.fn(),
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
        isDraftsMailbox: false, activeComposerMessageId: null, composerMode: "new", composerProps,
        onOpenReply: vi.fn(), onOpenForward: vi.fn(), onEditDraft: vi.fn(),
      },
    });
    flushSync();
    expect(host.querySelector(".oe-composer")).not.toBeNull();
    expect(host.textContent).not.toMatch(/select a message/i);
    unmount(app);
  });
});

describe("ReadingPane — archive/delete actions", () => {
  const baseProps = (over: Partial<Record<string, unknown>> = {}) => ({
    openMessages: open(), autoLoadImages: false, renderDeps, onClose: () => {}, onCollapse: vi.fn(), onDownload: vi.fn(),
    isDraftsMailbox: false, isArchiveMailbox: false, isTrashMailbox: false,
    activeComposerMessageId: null, composerMode: null, composerProps: null,
    onOpenReply: vi.fn(), onOpenForward: vi.fn(), onEditDraft: vi.fn(),
    onArchiveMessage: vi.fn(), onDeleteMessage: vi.fn(), onSaveToVault: vi.fn(),
    ...over,
  });

  it("shows Save to vault in a normal mailbox, and clicking it calls onSaveToVault(m1)", () => {
    const onSaveToVault = vi.fn();
    const host = document.createElement("div");
    const app = mount(ReadingPane, { target: host, props: baseProps({ onSaveToVault }) });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="save-to-vault"]')!.click();
    expect(onSaveToVault).toHaveBeenCalledWith("m1");
    unmount(app);
  });

  it("still shows Save to vault in Drafts and Trash mailboxes", () => {
    for (const over of [{ isDraftsMailbox: true }, { isTrashMailbox: true }]) {
      const host = document.createElement("div");
      const app = mount(ReadingPane, { target: host, props: baseProps(over) });
      flushSync();
      expect(host.querySelector('[data-action="save-to-vault"]')).not.toBeNull();
      unmount(app);
    }
  });

  it("clicking the floating close button calls onCollapse", () => {
    const onCollapse = vi.fn();
    const host = document.createElement("div");
    const app = mount(ReadingPane, { target: host, props: baseProps({ onCollapse }) });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="collapse"]')!.click();
    expect(onCollapse).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("shows Archive and Delete on a message in a normal mailbox", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, { target: host, props: baseProps() });
    flushSync();
    expect(host.querySelector('[data-action="archive"]')).not.toBeNull();
    expect(host.querySelector('[data-action="delete"]')).not.toBeNull();
    unmount(app);
  });

  it("hides Reply/Reply-all/Forward and Archive in the Trash mailbox, but keeps Delete", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, { target: host, props: baseProps({ isTrashMailbox: true }) });
    flushSync();
    expect(host.querySelector('[data-action="reply"]')).toBeNull();
    expect(host.querySelector('[data-action="archive"]')).toBeNull();
    expect(host.querySelector('[data-action="delete"]')).not.toBeNull();
    unmount(app);
  });

  it("hides Archive (but not Delete) in the Archive mailbox, keeping Reply/Reply-all/Forward", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, { target: host, props: baseProps({ isArchiveMailbox: true }) });
    flushSync();
    expect(host.querySelector('[data-action="reply"]')).not.toBeNull();
    expect(host.querySelector('[data-action="archive"]')).toBeNull();
    expect(host.querySelector('[data-action="delete"]')).not.toBeNull();
    unmount(app);
  });

  it("in Drafts, shows Edit and Delete but not Archive", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, { target: host, props: baseProps({ isDraftsMailbox: true }) });
    flushSync();
    expect(host.querySelector('[data-action="edit-draft"]')).not.toBeNull();
    expect(host.querySelector('[data-action="archive"]')).toBeNull();
    expect(host.querySelector('[data-action="delete"]')).not.toBeNull();
    unmount(app);
  });

  it("clicking Archive calls onArchiveMessage(m1)", () => {
    const onArchiveMessage = vi.fn();
    const host = document.createElement("div");
    const app = mount(ReadingPane, { target: host, props: baseProps({ onArchiveMessage }) });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="archive"]')!.click();
    expect(onArchiveMessage).toHaveBeenCalledWith("m1");
    unmount(app);
  });

  it("clicking Delete calls onDeleteMessage(m1)", () => {
    const onDeleteMessage = vi.fn();
    const host = document.createElement("div");
    const app = mount(ReadingPane, { target: host, props: baseProps({ onDeleteMessage }) });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="delete"]')!.click();
    expect(onDeleteMessage).toHaveBeenCalledWith("m1");
    unmount(app);
  });
});
