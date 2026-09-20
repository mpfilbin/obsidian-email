import { describe, it, expect, vi } from "vitest";
import {
  COMMANDS, commandsForTab, groupsForTab, visibleTabs,
  type RibbonActions, type RibbonContext,
} from "../../src/view/ribbon/registry";

function actions(): RibbonActions {
  const names = [
    "newMessage", "reply", "replyAll", "forward", "editDraft", "archive", "deleteMessage", "move",
    "closePane", "refresh", "toggleSearch", "newFolder", "renameFolder", "deleteFolder", "saveToVault",
    "emailFromNote", "emailWithNoteAttached", "send", "saveDraft", "discardDraft", "attachNote",
    "toggleContacts", "newContact", "editContact", "deleteContact", "emailContact", "refreshContacts",
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as unknown as RibbonActions;
}

function ctx(over: Partial<RibbonContext> = {}): RibbonContext {
  return {
    hasAccount: true, hasOpenThread: true, hasTargetMessage: true, mailboxKind: "inbox",
    otherMailboxes: [{ id: "ARCH", name: "Archive" }], readingPaneCollapsed: false, syncing: false, searchOpen: false,
    composerMode: null, composerSending: false,
    mode: "mail", hasSelectedContact: false, selectedContactHasEmail: false, contactEditing: false, contactsBlocked: false, contactsSyncing: false,
    actions: actions(), ...over,
  };
}

const cmd = (id: string) => COMMANDS.find((c) => c.id === id)!;
const enabled = (id: string, c: RibbonContext) => cmd(id).enabled(c);

describe("ribbon registry — tabs", () => {
  it("hides the Message tab unless a composer is open", () => {
    expect(visibleTabs(ctx()).map((t) => t.id)).toEqual(["home", "folder", "vault"]);
    expect(visibleTabs(ctx({ composerMode: "new" })).map((t) => t.id)).toEqual(["home", "folder", "vault", "message"]);
  });

  it("groups Home commands as New, Respond, Manage, Sync, Search, View", () => {
    expect(groupsForTab("home", ctx())).toEqual(["New", "Respond", "Manage", "Sync", "Search", "View"]);
  });

  it("every command id is unique", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("ribbon registry — Home enabled rules", () => {
  it("respond commands need a target message and are disabled in Drafts and Trash", () => {
    for (const id of ["reply", "reply-all", "forward"]) {
      expect(enabled(id, ctx())).toBe(true);
      expect(enabled(id, ctx({ hasTargetMessage: false }))).toBe(false);
      expect(enabled(id, ctx({ mailboxKind: "drafts" }))).toBe(false);
      expect(enabled(id, ctx({ mailboxKind: "trash" }))).toBe(false);
    }
  });

  it("Edit is only visible in Drafts, and needs a target", () => {
    expect(commandsForTab("home", ctx()).some((c) => c.id === "edit-draft")).toBe(false);
    const drafts = ctx({ mailboxKind: "drafts" });
    expect(commandsForTab("home", drafts).some((c) => c.id === "edit-draft")).toBe(true);
    expect(enabled("edit-draft", drafts)).toBe(true);
    expect(enabled("edit-draft", ctx({ mailboxKind: "drafts", hasTargetMessage: false }))).toBe(false);
  });

  it("Archive is disabled in Archive, Drafts and Trash", () => {
    expect(enabled("archive", ctx())).toBe(true);
    for (const kind of ["archive", "drafts", "trash"] as const) {
      expect(enabled("archive", ctx({ mailboxKind: kind }))).toBe(false);
    }
  });

  it("Delete needs a target message", () => {
    expect(enabled("delete", ctx())).toBe(true);
    expect(enabled("delete", ctx({ hasTargetMessage: false }))).toBe(false);
  });

  it("Move lists the other mailboxes and needs an open thread", () => {
    expect(enabled("move", ctx())).toBe(true);
    expect(enabled("move", ctx({ hasOpenThread: false }))).toBe(false);
    expect(enabled("move", ctx({ otherMailboxes: [] }))).toBe(false);
    const c = ctx();
    const opts = cmd("move").options!(c);
    expect(opts.map((o) => o.label)).toEqual(["Archive"]);
    opts[0].run();
    expect(c.actions.move).toHaveBeenCalledWith("ARCH");
  });

  it("Close pane is enabled only while the reading pane is open", () => {
    expect(enabled("close-pane", ctx())).toBe(true);
    expect(enabled("close-pane", ctx({ readingPaneCollapsed: true }))).toBe(false);
  });

  it("Refresh is disabled while syncing or with no account", () => {
    expect(enabled("refresh", ctx())).toBe(true);
    expect(enabled("refresh", ctx({ syncing: true }))).toBe(false);
    expect(enabled("refresh", ctx({ hasAccount: false }))).toBe(false);
  });

  it("Search is a toggle: needs an account, is pressed while the field is open, and toggles on click", () => {
    expect(enabled("search", ctx())).toBe(true);
    expect(enabled("search", ctx({ hasAccount: false }))).toBe(false);
    expect(cmd("search").pressed!(ctx())).toBe(false);
    expect(cmd("search").pressed!(ctx({ searchOpen: true }))).toBe(true);
    const c = ctx();
    cmd("search").run!(c);
    expect(c.actions.toggleSearch).toHaveBeenCalledOnce();
  });

  it("only Search and Contacts are toggle-style (pressed) commands", () => {
    expect(COMMANDS.filter((c) => c.pressed).map((c) => c.id)).toEqual(["search", "contacts"]);
  });

  it("New message needs an account", () => {
    expect(enabled("new-message", ctx())).toBe(true);
    expect(enabled("new-message", ctx({ hasAccount: false }))).toBe(false);
  });
});

describe("ribbon registry — Folder and Vault", () => {
  it("Rename and Delete folder apply only to custom folders", () => {
    for (const id of ["rename-folder", "delete-folder"]) {
      expect(enabled(id, ctx({ mailboxKind: "custom" }))).toBe(true);
      expect(enabled(id, ctx({ mailboxKind: "inbox" }))).toBe(false);
    }
    expect(enabled("new-folder", ctx())).toBe(true);
  });

  it("Save to vault needs a target message; the note commands are always available", () => {
    expect(enabled("save-to-vault", ctx())).toBe(true);
    expect(enabled("save-to-vault", ctx({ hasTargetMessage: false }))).toBe(false);
    expect(enabled("email-from-note", ctx({ hasAccount: false }))).toBe(true);
    expect(enabled("email-with-note-attached", ctx({ hasAccount: false }))).toBe(true);
  });
});

describe("ribbon registry — Message tab", () => {
  it("Send/Discard are disabled while sending; Save draft only in draft-backed modes", () => {
    const composing = ctx({ composerMode: "new" });
    expect(enabled("send", composing)).toBe(true);
    expect(enabled("send", ctx({ composerMode: "new", composerSending: true }))).toBe(false);
    expect(enabled("discard-draft", ctx({ composerMode: "reply", composerSending: true }))).toBe(false);
    expect(enabled("save-draft", composing)).toBe(true);
    expect(enabled("save-draft", ctx({ composerMode: "editDraft" }))).toBe(true);
    expect(enabled("save-draft", ctx({ composerMode: "reply" }))).toBe(false);
  });

  it("Attach note is only for brand-new messages (Graph takes attachments at creation)", () => {
    expect(enabled("attach-note", ctx({ composerMode: "new" }))).toBe(true);
    for (const mode of ["reply", "replyAll", "forward", "editDraft"] as const) {
      expect(enabled("attach-note", ctx({ composerMode: mode }))).toBe(false);
    }
  });

  it("run() delegates to the matching action", () => {
    const c = ctx({ composerMode: "new" });
    cmd("send").run!(c);
    cmd("attach-note").run!(c);
    expect(c.actions.send).toHaveBeenCalledOnce();
    expect(c.actions.attachNote).toHaveBeenCalledOnce();
  });
});

describe("ribbon registry — contacts", () => {
  const inContacts = (over: Partial<RibbonContext> = {}) => ctx({ mode: "contacts", ...over });

  it("shows the Contacts tab only in contacts mode", () => {
    expect(visibleTabs(ctx()).map((t) => t.id)).not.toContain("contacts");
    expect(visibleTabs(inContacts()).map((t) => t.id)).toEqual(["home", "folder", "vault", "contacts"]);
  });

  it("the Contacts toggle needs an account and reflects the mode as pressed", () => {
    expect(enabled("contacts", ctx({ hasAccount: false }))).toBe(false);
    expect(enabled("contacts", ctx())).toBe(true);
    expect(cmd("contacts").pressed?.(ctx())).toBe(false);
    expect(cmd("contacts").pressed?.(inContacts())).toBe(true);
    const c = ctx();
    cmd("contacts").run!(c);
    expect(c.actions.toggleContacts).toHaveBeenCalledOnce();
  });

  it("mail-only commands are disabled in contacts mode; compose entry points stay enabled", () => {
    const c = inContacts({ hasTargetMessage: true, hasOpenThread: true, mailboxKind: "custom" });
    for (const id of ["reply", "reply-all", "forward", "archive", "delete", "move", "close-pane", "refresh", "search", "new-folder", "rename-folder", "delete-folder", "save-to-vault"]) {
      expect(enabled(id, c), id).toBe(false);
    }
    for (const id of ["new-message", "email-from-note", "email-with-note-attached"]) {
      expect(enabled(id, c), id).toBe(true);
    }
  });

  it("mail commands are unchanged in mail mode", () => {
    expect(enabled("reply", ctx())).toBe(true);
    expect(enabled("search", ctx())).toBe(true);
  });

  it("New contact needs an account, contacts mode, and unblocked access", () => {
    expect(enabled("new-contact", inContacts())).toBe(true);
    expect(enabled("new-contact", inContacts({ contactsBlocked: true }))).toBe(false);
    expect(enabled("new-contact", inContacts({ hasAccount: false }))).toBe(false);
  });

  it("Edit/Delete need a selected contact and no open form; Email needs an address", () => {
    expect(enabled("edit-contact", inContacts())).toBe(false);
    expect(enabled("edit-contact", inContacts({ hasSelectedContact: true }))).toBe(true);
    expect(enabled("edit-contact", inContacts({ hasSelectedContact: true, contactEditing: true }))).toBe(false);
    expect(enabled("delete-contact", inContacts({ hasSelectedContact: true }))).toBe(true);
    expect(enabled("delete-contact", inContacts({ hasSelectedContact: true, contactEditing: true }))).toBe(false);
    expect(enabled("email-contact", inContacts({ hasSelectedContact: true }))).toBe(false);
    expect(enabled("email-contact", inContacts({ hasSelectedContact: true, selectedContactHasEmail: true }))).toBe(true);
  });

  it("Refresh contacts is disabled while syncing", () => {
    expect(enabled("refresh-contacts", inContacts())).toBe(true);
    expect(enabled("refresh-contacts", inContacts({ contactsSyncing: true }))).toBe(false);
  });

  it("the Contacts tab groups are View, Contact, Sync, and each command runs its action", () => {
    const c = inContacts({ hasSelectedContact: true, selectedContactHasEmail: true });
    expect(groupsForTab("contacts", c)).toEqual(["View", "Contact", "Sync"]);
    for (const [id, action] of [["show-mail", "toggleContacts"], ["new-contact", "newContact"], ["edit-contact", "editContact"], ["delete-contact", "deleteContact"], ["email-contact", "emailContact"], ["refresh-contacts", "refreshContacts"]] as const) {
      cmd(id).run!(c);
      expect(c.actions[action], id).toHaveBeenCalledOnce();
    }
  });
});
