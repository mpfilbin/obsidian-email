import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import BulkActionBar from "../../src/view/components/BulkActionBar.svelte";
import type { Mailbox } from "../../src/providers/types";

const boxes: Mailbox[] = [
  { id: "ARCHIVE", name: "Archive", kind: "archive" },
  { id: "P", name: "Projects", kind: "custom" },
];

function setup(over: Record<string, unknown> = {}) {
  const handlers = {
    onSelectAll: vi.fn(), onClear: vi.fn(), onMarkRead: vi.fn(), onMarkUnread: vi.fn(),
    onArchive: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(),
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = mount(BulkActionBar, { target: host, props: { count: 2, total: 5, moveTargets: boxes, showArchive: true, ...handlers, ...over } });
  flushSync();
  const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
  return { host, q, handlers, done: () => { unmount(app); host.remove(); } };
}

describe("BulkActionBar", () => {
  it("is a labelled toolbar that announces how many conversations are selected", () => {
    const s = setup({ count: 3 });
    expect(s.q('[role="toolbar"]')!.getAttribute("aria-label")).toMatch(/selected conversations/i);
    expect(s.q(".oe-bulk-count")!.textContent).toBe("3 selected");
    expect(s.q(".oe-bulk-count")!.getAttribute("aria-live")).toBe("polite");
    s.done();
  });

  it("each button calls its handler", () => {
    const s = setup();
    for (const [action, handler] of [
      ["select-all", "onSelectAll"], ["mark-unread", "onMarkUnread"], ["mark-read", "onMarkRead"],
      ["archive", "onArchive"], ["delete", "onDelete"], ["clear", "onClear"],
    ] as const) {
      s.q(`[data-action="${action}"]`)!.click();
      expect(s.handlers[handler], action).toHaveBeenCalledOnce();
    }
    s.done();
  });

  it("offers Select all only while some loaded conversations are unselected", () => {
    const some = setup({ count: 2, total: 5 });
    expect(some.q('[data-action="select-all"]')).not.toBeNull();
    some.done();
    const all = setup({ count: 5, total: 5 });
    expect(all.q('[data-action="select-all"]')).toBeNull();
    all.done();
  });

  it("hides Archive where archiving makes no sense", () => {
    const s = setup({ showArchive: false });
    expect(s.q('[data-action="archive"]')).toBeNull();
    s.done();
  });

  it("lists the move destinations after a 'Move to…' prompt, and moving calls onMove then resets the prompt", () => {
    const s = setup();
    const select = s.q<HTMLSelectElement>('select[data-action="move"]')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Move to…", "Archive", "Projects"]);
    expect(select.options[0].disabled).toBe(true);
    select.value = "P";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(s.handlers.onMove).toHaveBeenCalledWith("P");
    expect(select.value).toBe("");
    s.done();
  });

  it("has no Move control when there is nowhere to move to", () => {
    const s = setup({ moveTargets: [] });
    expect(s.q('select[data-action="move"]')).toBeNull();
    s.done();
  });

  it("choosing the empty prompt doesn't move anything", () => {
    const s = setup();
    const select = s.q<HTMLSelectElement>('select[data-action="move"]')!;
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(s.handlers.onMove).not.toHaveBeenCalled();
    s.done();
  });
});
