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
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as unknown as RibbonActions;
}

function ctx(over: Partial<RibbonContext> = {}): RibbonContext {
  return {
    hasAccount: true, hasOpenThread: true, hasTargetMessage: true, mailboxKind: "inbox",
    otherMailboxes: [{ id: "ARCH", name: "Archive" }], readingPaneCollapsed: false, syncing: false, searchOpen: false,
    composerMode: null, composerSending: false, actions: actions(), ...over,
  };
}

const cmd = (id: string) => COMMANDS.find((c) => c.id === id)!;
const enabled = (id: string, c: RibbonContext) => cmd(id).enabled(c);

describe("ribbon registry — tabs", () => {
  it("hides the Message tab unless a composer is open", () => {
    expect(visibleTabs(ctx()).map((t) => t.id)).toEqual(["home", "folder", "vault"]);
    expect(visibleTabs(ctx({ composerMode: "new" })).map((t) => t.id)).toEqual(["home", "folder", "vault", "message"]);
  });

  it("groups Home commands as New, Respond, Manage, Sync, Search", () => {
    expect(groupsForTab("home", ctx())).toEqual(["New", "Respond", "Manage", "Sync", "Search"]);
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

  it("only Search is a toggle-style (pressed) command", () => {
    expect(COMMANDS.filter((c) => c.pressed).map((c) => c.id)).toEqual(["search"]);
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
