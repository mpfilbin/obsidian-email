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

/** The message header whose sender is `who` (the `msg` fixture names each sender
 *  after its id) — selected by name so tests don't depend on display order. */
const headFor = (host: HTMLElement, who: string): HTMLElement =>
  [...host.querySelectorAll<HTMLElement>(".oe-message-head")].find((h) => h.textContent?.includes(who))!;

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

  it("lists the messages newest first, with the newest expanded at the top", () => {
    const host = document.createElement("div");
    // `openMessages` is oldest → newest.
    const app = mount(ReadingPane, {
      target: host,
      props: {
        openMessages: [msg("aa1", "A one"), msg("aa2", "A two"), msg("aa3", "A three")],
        autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn(),
      },
    });
    flushSync();
    const blocks = [...host.querySelectorAll(".oe-message-block")];
    expect(blocks.map((b) => b.querySelector(".oe-message-from")!.textContent)).toEqual(["aa3", "aa2", "aa1"]);
    expect(blocks.map((b) => b.classList.contains("is-expanded"))).toEqual([true, false, false]);
    // The subject line still comes from the newest message.
    expect(host.querySelector(".oe-reading-head h3")!.textContent).toBe("A three");
    unmount(app);
  });

  it("does not mutate the openMessages array it was given", () => {
    const host = document.createElement("div");
    const messages = [msg("aa1", "A one"), msg("aa2", "A two")];
    const app = mount(ReadingPane, {
      target: host,
      props: { openMessages: messages, autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn() },
    });
    flushSync();
    expect(messages.map((m) => m.summary.id)).toEqual(["aa1", "aa2"]);
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
    headFor(host, "aa2").click();
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
    const olderHead = headFor(host, "aa1");
    olderHead.click();
    flushSync();
    expect(host.querySelector(".oe-message-block.is-expanded")?.textContent).toContain("aa1");

    // Ending a drag-selection on that same header must not collapse it.
    const selectionSpy = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "some selected text",
    } as Selection);
    try {
      olderHead.click();
      flushSync();
      expect(host.querySelector(".oe-message-block.is-expanded")?.textContent).toContain("aa1");

      // A plain click (no active selection) still toggles normally — falls
      // back to the last message expanding instead.
      selectionSpy.mockReturnValue({ toString: () => "" } as Selection);
      olderHead.click();
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
    const head = headFor(host, "aa1");

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

  const mountPane = (over: Record<string, unknown>) => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, {
      target: host,
      props: { openMessages: open(), autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn(), ...over },
    });
    flushSync();
    return { host, app };
  };

  for (const mode of ["reply", "replyAll", "forward"] as const) {
    it(`renders the ${mode} Composer at the top of the thread, above the subject header and messages`, () => {
      const { host, app } = mountPane({ activeComposerMessageId: "m1", composerMode: mode, composerProps });
      const scroll = host.querySelector(".oe-reading-scroll")!;
      expect(scroll.firstElementChild!.classList.contains("oe-reply-composer")).toBe(true);
      expect(scroll.firstElementChild!.querySelector(".oe-composer")).not.toBeNull();
      expect(scroll.querySelector(".oe-reply-composer")!.nextElementSibling!.classList.contains("oe-reading-head")).toBe(true);
      unmount(app);
    });
  }

  it("does not render the composer inside any message block", () => {
    const { host, app } = mountPane({ activeComposerMessageId: "m1", composerMode: "reply", composerProps });
    expect(host.querySelector(".oe-message-block .oe-composer")).toBeNull();
    expect(host.querySelectorAll(".oe-composer")).toHaveLength(1);
    unmount(app);
  });

  it("keeps the composer visible when the message being replied to is collapsed", () => {
    // targetMessageId null = nothing expanded, so m1's block is collapsed.
    const { host, app } = mountPane({ targetMessageId: null, activeComposerMessageId: "m1", composerMode: "reply", composerProps });
    expect(host.querySelector(".oe-message-block.is-expanded")).toBeNull();
    expect(host.querySelector(".oe-reply-composer .oe-composer")).not.toBeNull();
    unmount(app);
  });

  it("renders no composer wrapper when no inline composer is open", () => {
    const { host, app } = mountPane({ composerMode: null, composerProps: null });
    expect(host.querySelector(".oe-reply-composer")).toBeNull();
    unmount(app);
  });

  it("scrolls to the top when an inline composer opens or is replaced, but not while typing", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPaneHost, { target: host, props: { initial: open(), renderDeps, onClose: () => {}, onDownload: vi.fn() } });
    flushSync();
    const ctl = app as unknown as { setComposer: (c: unknown) => void };
    const scroll = host.querySelector<HTMLElement>(".oe-reading-scroll")!;
    const sets: number[] = [];
    Object.defineProperty(scroll, "scrollTop", { configurable: true, get: () => 300, set: (v: number) => { sets.push(v); } });

    ctl.setComposer({ mode: "reply", id: "m1", props: composerProps });
    flushSync();
    expect(sets).toEqual([0]);

    // Every keystroke rebuilds the props object; that must not re-scroll.
    ctl.setComposer({ mode: "reply", id: "m1", props: { ...composerProps, bodyHtml: "<p>hi</p>" } });
    flushSync();
    expect(sets).toEqual([0]);

    // A different composer (here: Forward) is a fresh one and scrolls again.
    ctl.setComposer({ mode: "forward", id: "m1", props: composerProps });
    flushSync();
    expect(sets).toEqual([0, 0]);
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

describe("ReadingPane message flag toggle", () => {
  const mountPane = (messages: ViewState["openMessages"], onToggleFlag = vi.fn()) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(ReadingPane, {
      target: host,
      props: { openMessages: messages, autoLoadImages: false, renderDeps, onClose: vi.fn(), onDownload: vi.fn(), onToggleFlag },
    });
    flushSync();
    return { host, onToggleFlag, done: () => { unmount(app); host.remove(); } };
  };

  it("each message header has a flag toggle that reports its id and reflects the state", () => {
    const msgs = open();
    msgs[0] = { ...msgs[0], summary: { ...msgs[0].summary, flagged: true } };
    const { host, onToggleFlag, done } = mountPane(msgs);
    const btn = host.querySelector<HTMLButtonElement>(".oe-message-flag")!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.classList.contains("is-flagged")).toBe(true);
    btn.click();
    expect(onToggleFlag).toHaveBeenCalledWith("m1");
    done();
  });

  it("toggling the flag does not expand or collapse the message (click or keyboard)", () => {
    const onToggleExpand = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(ReadingPane, {
      target: host,
      props: { openMessages: open(), autoLoadImages: false, renderDeps, onClose: vi.fn(), onDownload: vi.fn(), onToggleFlag: vi.fn(), onToggleExpand },
    });
    flushSync();
    const btn = host.querySelector<HTMLButtonElement>(".oe-message-flag")!;
    btn.click();
    for (const key of ["Enter", " "]) {
      btn.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
    flushSync();
    expect(onToggleExpand).not.toHaveBeenCalled();
    unmount(app);
    host.remove();
  });

  it("control: clicking or pressing Enter/Space on the header itself does toggle expansion", () => {
    const onToggleExpand = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(ReadingPane, {
      target: host,
      props: { openMessages: open(), autoLoadImages: false, renderDeps, onClose: vi.fn(), onDownload: vi.fn(), onToggleFlag: vi.fn(), onToggleExpand },
    });
    flushSync();
    const head = host.querySelector<HTMLElement>(".oe-message-head")!;
    head.click();
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    expect(onToggleExpand).toHaveBeenLastCalledWith("m1");
    head.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    head.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(onToggleExpand).toHaveBeenCalledTimes(3);
    unmount(app);
    host.remove();
  });
});
