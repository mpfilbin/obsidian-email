import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import Ribbon from "../../src/view/ribbon/Ribbon.svelte";
import RibbonHost from "./fixtures/RibbonHost.svelte";
import type { RibbonActions, RibbonContext } from "../../src/view/ribbon/registry";

function actions(): RibbonActions {
  const names = [
    "newMessage", "reply", "replyAll", "forward", "editDraft", "archive", "deleteMessage", "move",
    "closePane", "refresh", "newFolder", "renameFolder", "deleteFolder", "saveToVault",
    "emailFromNote", "emailWithNoteAttached", "send", "saveDraft", "discardDraft", "attachNote",
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as unknown as RibbonActions;
}

function ctx(over: Partial<RibbonContext> = {}): RibbonContext {
  return {
    hasAccount: true, hasOpenThread: true, hasTargetMessage: true, mailboxKind: "inbox",
    otherMailboxes: [{ id: "ARCH", name: "Archive" }, { id: "P", name: "Project" }],
    readingPaneCollapsed: false, syncing: false, composerMode: null, composerSending: false,
    actions: actions(), ...over,
  };
}

const q = (host: HTMLElement, sel: string) => host.querySelector<HTMLElement>(sel);

describe("Ribbon smoke", () => {
  it("renders the visible tabs, with Home active and its groups shown", () => {
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: ctx(), defaultCollapsed: false } });
    flushSync();
    expect([...host.querySelectorAll(".oe-ribbon-tab")].map((t) => t.textContent?.trim())).toEqual(["Home", "Folder", "Vault"]);
    expect(q(host, '.oe-ribbon-tab[data-tab="home"]')!.classList.contains("active")).toBe(true);
    expect(host.textContent).toContain("Respond");
    expect(q(host, '[data-action="reply"]')).not.toBeNull();
    unmount(app);
  });

  it("clicking a button runs its action", () => {
    const c = ctx();
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: c, defaultCollapsed: false } });
    flushSync();
    q(host, '[data-action="reply"]')!.click();
    expect(c.actions.reply).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("disabled buttons do not run their action", () => {
    const c = ctx({ hasTargetMessage: false });
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: c, defaultCollapsed: false } });
    flushSync();
    const btn = q(host, '[data-action="reply"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    btn.click();
    expect(c.actions.reply).not.toHaveBeenCalled();
    unmount(app);
  });

  it("switching tabs shows that tab's commands", () => {
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: ctx(), defaultCollapsed: false } });
    flushSync();
    q(host, '.oe-ribbon-tab[data-tab="folder"]')!.click();
    flushSync();
    expect(q(host, '[data-action="new-folder"]')).not.toBeNull();
    expect(q(host, '[data-action="reply"]')).toBeNull();
    unmount(app);
  });

  it("double-clicking a tab collapses the panel to just the tab strip, and again expands it", () => {
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: ctx(), defaultCollapsed: false } });
    flushSync();
    const tab = q(host, '.oe-ribbon-tab[data-tab="home"]')!;
    tab.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    flushSync();
    expect(q(host, ".oe-ribbon")!.classList.contains("collapsed")).toBe(true);
    expect(q(host, ".oe-ribbon-panel")).toBeNull();
    tab.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    flushSync();
    expect(q(host, ".oe-ribbon-panel")).not.toBeNull();
    unmount(app);
  });

  it("starts collapsed when defaultCollapsed is set", () => {
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: ctx(), defaultCollapsed: true } });
    flushSync();
    expect(q(host, ".oe-ribbon-panel")).toBeNull();
    unmount(app);
  });

  it("Move opens a menu of the other folders; choosing one calls move with its id", () => {
    const c = ctx();
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: c, defaultCollapsed: false } });
    flushSync();
    expect(q(host, ".oe-ribbon-menu")).toBeNull();
    q(host, '[data-action="move"]')!.click();
    flushSync();
    expect([...host.querySelectorAll(".oe-ribbon-menu-item")].map((i) => i.textContent?.trim())).toEqual(["Archive", "Project"]);
    q(host, '.oe-ribbon-menu-item[data-option="P"]')!.click();
    flushSync();
    expect(c.actions.move).toHaveBeenCalledWith("P");
    expect(q(host, ".oe-ribbon-menu")).toBeNull();
    unmount(app);
  });

  it("shows the Message tab and switches to it when a composer opens, then restores the previous tab on close", () => {
    const host = document.createElement("div");
    const app = mount(RibbonHost, { target: host, props: { initial: ctx() } });
    flushSync();
    q(host, '.oe-ribbon-tab[data-tab="vault"]')!.click();
    flushSync();
    expect(q(host, '.oe-ribbon-tab[data-tab="message"]')).toBeNull();

    (app as unknown as { set: (c: RibbonContext) => void }).set(ctx({ composerMode: "new" }));
    flushSync();
    expect(q(host, '.oe-ribbon-tab[data-tab="message"]')!.classList.contains("active")).toBe(true);
    expect(q(host, '[data-action="send"]')).not.toBeNull();

    (app as unknown as { set: (c: RibbonContext) => void }).set(ctx({ composerMode: null }));
    flushSync();
    expect(q(host, '.oe-ribbon-tab[data-tab="message"]')).toBeNull();
    expect(q(host, '.oe-ribbon-tab[data-tab="vault"]')!.classList.contains("active")).toBe(true);
    unmount(app);
  });

  it("falls back to Home if the active tab disappears for any other reason", () => {
    const host = document.createElement("div");
    const app = mount(RibbonHost, { target: host, props: { initial: ctx({ composerMode: "new" }) } });
    flushSync();
    // Composer already open at mount: Message tab is offered and selected.
    expect(q(host, '.oe-ribbon-tab[data-tab="message"]')!.classList.contains("active")).toBe(true);
    (app as unknown as { set: (c: RibbonContext) => void }).set(ctx({ composerMode: null }));
    flushSync();
    expect(q(host, '.oe-ribbon-tab[data-tab="home"]')!.classList.contains("active")).toBe(true);
    unmount(app);
  });
});
