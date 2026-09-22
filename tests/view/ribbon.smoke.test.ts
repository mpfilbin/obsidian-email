import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import Ribbon from "../../src/view/ribbon/Ribbon.svelte";
import RibbonHost from "./fixtures/RibbonHost.svelte";
import type { RibbonActions, RibbonContext } from "../../src/view/ribbon/registry";

function actions(): RibbonActions {
  const names = [
    "newMessage", "reply", "replyAll", "forward", "editDraft", "archive", "deleteMessage", "move",
    "closePane", "refresh", "toggleSearch", "newFolder", "renameFolder", "deleteFolder", "saveToVault",
    "emailFromNote", "emailWithNoteAttached", "send", "saveDraft", "discardDraft", "attachNote",
    "toggleContacts", "newContact", "editContact", "deleteContact", "emailContact", "refreshContacts", "toggleFlag", "togglePin",
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as unknown as RibbonActions;
}

function ctx(over: Partial<RibbonContext> = {}): RibbonContext {
  return {
    hasAccount: true, hasOpenThread: true, hasTargetMessage: true, mailboxKind: "inbox",
    otherMailboxes: [{ id: "ARCH", name: "Archive" }, { id: "P", name: "Project" }],
    readingPaneCollapsed: false, syncing: false, searchOpen: false, composerMode: null, composerSending: false, openThreadFlagged: false, openThreadPinned: false,
    mode: "mail", hasSelectedContact: false, selectedContactHasEmail: false, contactEditing: false, contactsBlocked: false, contactsSyncing: false,
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

  it("Search renders as a pressed toggle that follows ctx.searchOpen and runs toggleSearch", () => {
    const c = ctx();
    const host = document.createElement("div");
    const app = mount(RibbonHost, { target: host, props: { initial: c } });
    flushSync();
    const btn = () => q(host, '[data-action="search"]')!;
    expect(btn().getAttribute("aria-pressed")).toBe("false");
    expect(btn().classList.contains("active")).toBe(false);
    btn().click();
    expect(c.actions.toggleSearch).toHaveBeenCalledOnce();

    (app as unknown as { set: (c: RibbonContext) => void }).set(ctx({ searchOpen: true }));
    flushSync();
    expect(btn().getAttribute("aria-pressed")).toBe("true");
    expect(btn().classList.contains("active")).toBe(true);
    // Non-toggle buttons never carry aria-pressed.
    expect(q(host, '[data-action="reply"]')!.hasAttribute("aria-pressed")).toBe(false);
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
    expect(q(host, ".oe-ribbon")!.classList.contains("collapsed")).toBe(true);
    unmount(app);
  });

  it("Move opens a menu (portaled to body) of the other folders; choosing one calls move with its id", () => {
    const c = ctx();
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: c, defaultCollapsed: false } });
    flushSync();
    expect(document.body.querySelector(".oe-ribbon-menu")).toBeNull();
    q(host, '[data-action="move"]')!.click();
    flushSync();
    expect(host.querySelector(".oe-ribbon-menu")).toBeNull();
    expect([...document.body.querySelectorAll(".oe-ribbon-menu-item")].map((i) => i.textContent?.trim())).toEqual(["Archive", "Project"]);
    document.body.querySelector<HTMLElement>('.oe-ribbon-menu-item[data-option="P"]')!.click();
    flushSync();
    expect(c.actions.move).toHaveBeenCalledWith("P");
    expect(document.body.querySelector(".oe-ribbon-menu")).toBeNull();
    unmount(app);
    expect(document.querySelector(".oe-ribbon-menu")).toBeNull();
  });

  describe("Move dropdown dismissal", () => {
    const menu = () => document.body.querySelector<HTMLElement>(".oe-ribbon-menu");
    function openMove() {
      const host = document.createElement("div");
      const app = mount(RibbonHost, { target: host, props: { initial: ctx() } });
      flushSync();
      q(host, '[data-action="move"]')!.click();
      flushSync();
      expect(menu()).not.toBeNull();
      return { host, app };
    }

    it("Escape closes the open menu", () => {
      const { app } = openMove();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      flushSync();
      expect(menu()).toBeNull();
      unmount(app);
    });

    it("a mousedown outside closes the open menu", () => {
      const { app } = openMove();
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      flushSync();
      expect(menu()).toBeNull();
      unmount(app);
    });

    it("a mousedown inside the portaled menu does not close it", () => {
      const { app } = openMove();
      menu()!.querySelector(".oe-ribbon-menu-item")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      flushSync();
      expect(menu()).not.toBeNull();
      unmount(app);
      expect(menu()).toBeNull();
    });

    it("closes when the command becomes disabled", () => {
      const { app } = openMove();
      (app as unknown as { set: (c: RibbonContext) => void }).set(ctx({ hasOpenThread: false }));
      flushSync();
      expect(menu()).toBeNull();
      unmount(app);
    });
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

  it("selects the Message tab when a composer is already open at mount, and returns to Home when it closes", () => {
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

describe("Ribbon — contextual Contacts tab", () => {
  it("auto-selects the Contacts tab entering contacts mode, and restores the previous tab on leaving", () => {
    const host = document.createElement("div");
    const app = mount(RibbonHost, { target: host, props: { initial: ctx() } });
    flushSync();
    q(host, '.oe-ribbon-tab[data-tab="folder"]')!.click();
    flushSync();
    (app as unknown as { set: (c: RibbonContext) => void }).set(ctx({ mode: "contacts" }));
    flushSync();
    expect(q(host, '.oe-ribbon-tab[data-tab="contacts"]')!.classList.contains("active")).toBe(true);
    expect(q(host, '[data-action="new-contact"]')).not.toBeNull();
    (app as unknown as { set: (c: RibbonContext) => void }).set(ctx({ mode: "mail" }));
    flushSync();
    expect(q(host, '.oe-ribbon-tab[data-tab="contacts"]')).toBeNull();
    expect(q(host, '.oe-ribbon-tab[data-tab="folder"]')!.classList.contains("active")).toBe(true);
    unmount(app);
  });

  it("a composer opening straight from contacts mode moves to the Message tab, then back", () => {
    const host = document.createElement("div");
    const app = mount(RibbonHost, { target: host, props: { initial: ctx({ mode: "contacts" }) } });
    flushSync();
    const set = (c: RibbonContext) => (app as unknown as { set: (c: RibbonContext) => void }).set(c);
    set(ctx({ mode: "mail", composerMode: "new" }));
    flushSync();
    expect(q(host, '.oe-ribbon-tab[data-tab="message"]')!.classList.contains("active")).toBe(true);
    set(ctx({ mode: "mail", composerMode: null }));
    flushSync();
    expect(q(host, '.oe-ribbon-tab[data-tab="home"]')!.classList.contains("active")).toBe(true);
    unmount(app);
  });

  it("the Home Contacts button toggles and shows pressed", () => {
    const c = ctx();
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: c, defaultCollapsed: false } });
    flushSync();
    q(host, '[data-action="contacts"]')!.click();
    expect(c.actions.toggleContacts).toHaveBeenCalledOnce();
    unmount(app);
  });
});
