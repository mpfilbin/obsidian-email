import { describe, it, expect, vi } from "vitest";
import { makeMenus, type MenuItemLike, type MenuLike } from "../../src/host/menus";
import type { ThreadMenuActions } from "../../src/view/mail-view";

interface RecordedItem { title: string; icon?: string; warning?: boolean; click: () => void }
class FakeMenu implements MenuLike {
  items: RecordedItem[] = [];
  shown?: { kind: "mouse"; evt: MouseEvent } | { kind: "position"; x: number; y: number };
  addItem(cb: (item: MenuItemLike) => void): this {
    const rec: RecordedItem = { title: "", click: () => {} };
    const item: MenuItemLike = {
      setTitle: (t) => { rec.title = t; return item; },
      setIcon: (i) => { rec.icon = i; return item; },
      setWarning: (w) => { rec.warning = w; return item; },
      onClick: (c) => { rec.click = c; return item; },
    };
    cb(item);
    this.items.push(rec);
    return this;
  }
  showAtMouseEvent(evt: MouseEvent): void { this.shown = { kind: "mouse", evt }; }
  showAtPosition(p: { x: number; y: number }): void { this.shown = { kind: "position", ...p }; }
  titles = () => this.items.map((i) => i.title);
  click = (title: string) => this.items.find((i) => i.title === title)!.click();
}

function setup(now = new Date(2026, 9, 7, 15).getTime()) {
  const menus: FakeMenu[] = [];
  const openExternal = vi.fn();
  const promptFolderRename = vi.fn();
  const made = makeMenus({ newMenu: () => { const m = new FakeMenu(); menus.push(m); return m; }, openExternal, promptFolderRename, now: () => now });
  return { ...made, menus, openExternal, promptFolderRename };
}
const evt = (x = 40, y = 70) => ({ clientX: x, clientY: y }) as MouseEvent;

const actions = (over: Partial<ThreadMenuActions> = {}): ThreadMenuActions => ({
  candidates: [{ id: "A", name: "Archive", kind: "archive" }, { id: "P", name: "Project", kind: "custom" }] as never,
  onMove: vi.fn(), flagged: false, onToggleFlag: vi.fn(), onFlagFollowUp: vi.fn(), onFlagCustomFollowUp: vi.fn(),
  onCompleteFlag: vi.fn(), pinned: false, onTogglePin: vi.fn(), ...over,
});

describe("link context menu", () => {
  it("offers 'Open in default browser', which opens that URL externally", () => {
    const { showLinkContextMenu, menus, openExternal } = setup();
    const e = evt();
    showLinkContextMenu(e, "https://example.com");
    expect(menus[0].titles()).toEqual(["Open in default browser"]);
    expect(menus[0].shown).toEqual({ kind: "mouse", evt: e });
    expect(openExternal).not.toHaveBeenCalled();
    menus[0].click("Open in default browser");
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
  });
});

describe("mailbox context menu", () => {
  it("Rename prompts with the current name and passes the result to onRename; Delete is a warning item", () => {
    const { showMailboxContextMenu, menus, promptFolderRename } = setup();
    const onRename = vi.fn(); const onDelete = vi.fn();
    showMailboxContextMenu(evt(), "Projects", onRename, onDelete);
    expect(menus[0].titles()).toEqual(["Rename", "Delete"]);
    menus[0].click("Rename");
    expect(promptFolderRename).toHaveBeenCalledWith("Projects", onRename);
    expect(menus[0].items[1]).toMatchObject({ icon: "trash-2", warning: true });
    menus[0].click("Delete");
    expect(onDelete).toHaveBeenCalledOnce();
  });
});

describe("thread context menu", () => {
  it("shows Flag / Follow up / Pin / Move for an unflagged, unpinned thread — no 'Mark complete'", () => {
    const { showThreadContextMenu, menus } = setup();
    showThreadContextMenu(evt(), actions());
    expect(menus[0].titles()).toEqual(["Flag", "Follow up", "Pin", "Move"]);
  });

  it("flips labels and adds 'Mark complete' for a flagged, pinned thread", () => {
    const a = actions({ flagged: true, pinned: true });
    const { showThreadContextMenu, menus } = setup();
    showThreadContextMenu(evt(), a);
    expect(menus[0].titles()).toEqual(["Remove flag", "Follow up", "Mark complete", "Unpin", "Move"]);
    expect(menus[0].items[0].icon).toBe("flag-off");
    menus[0].click("Remove flag");
    menus[0].click("Mark complete");
    menus[0].click("Unpin");
    expect(a.onToggleFlag).toHaveBeenCalledOnce();
    expect(a.onCompleteFlag).toHaveBeenCalledOnce();
    expect(a.onTogglePin).toHaveBeenCalledOnce();
  });

  it("Follow up chains a menu of presets plus Custom date…, at the original click position", () => {
    const a = actions();
    const { showThreadContextMenu, menus } = setup(new Date(2026, 9, 7, 15).getTime()); // Wed Oct 7
    showThreadContextMenu(evt(40, 70), a);
    menus[0].click("Follow up");
    const follow = menus[1];
    expect(follow.titles()).toEqual(["Today", "Tomorrow", "Next week", "Custom date…"]);
    expect(follow.shown).toEqual({ kind: "position", x: 40, y: 70 });
    follow.click("Tomorrow");
    expect(a.onFlagFollowUp).toHaveBeenCalledWith(new Date(2026, 9, 8).getTime());
    follow.click("Next week");
    expect(a.onFlagFollowUp).toHaveBeenCalledWith(new Date(2026, 9, 12).getTime());
    follow.click("Custom date…");
    expect(a.onFlagCustomFollowUp).toHaveBeenCalledOnce();
  });

  it("Move chains a menu of the destination folders, at the original click position, and moves", () => {
    const a = actions();
    const { showThreadContextMenu, menus } = setup();
    showThreadContextMenu(evt(12, 34), a);
    menus[0].click("Move");
    expect(menus[1].titles()).toEqual(["Archive", "Project"]);
    expect(menus[1].shown).toEqual({ kind: "position", x: 12, y: 34 });
    menus[1].click("Project");
    expect(a.onMove).toHaveBeenCalledWith("P");
  });

  it("shows the main menu at the mouse event", () => {
    const { showThreadContextMenu, menus } = setup();
    const e = evt();
    showThreadContextMenu(e, actions());
    expect(menus[0].shown).toEqual({ kind: "mouse", evt: e });
  });
});
