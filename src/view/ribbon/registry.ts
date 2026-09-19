import type { MailboxKind } from "../../providers/types";
import type { ComposerState } from "../view-model";
import { ACTION_ICON } from "../action-icons";

export type TabId = "home" | "folder" | "vault" | "message";

export interface RibbonMailboxOption { id: string; name: string }

export interface RibbonActions {
  newMessage(): void;
  reply(): void;
  replyAll(): void;
  forward(): void;
  editDraft(): void;
  archive(): void;
  deleteMessage(): void;
  move(destinationMailboxId: string): void;
  closePane(): void;
  refresh(): void;
  newFolder(): void;
  renameFolder(): void;
  deleteFolder(): void;
  saveToVault(): void;
  emailFromNote(): void;
  emailWithNoteAttached(): void;
  send(): void;
  saveDraft(): void;
  discardDraft(): void;
  attachNote(): void;
}

export interface RibbonContext {
  hasAccount: boolean;
  hasOpenThread: boolean;
  /** An expanded message exists in the open thread — the target of Reply, Archive, Delete… */
  hasTargetMessage: boolean;
  mailboxKind: MailboxKind | null;
  /** Every mailbox except the active one — the Move destinations. */
  otherMailboxes: RibbonMailboxOption[];
  readingPaneCollapsed: boolean;
  syncing: boolean;
  composerMode: ComposerState["mode"] | null;
  composerSending: boolean;
  actions: RibbonActions;
}

export interface RibbonOption { id: string; label: string; run: () => void }

export interface RibbonCommand {
  /** Also emitted as `data-action` on the rendered button. */
  id: string;
  tab: TabId;
  group: string;
  icon: string;
  label: string;
  enabled: (ctx: RibbonContext) => boolean;
  visible?: (ctx: RibbonContext) => boolean;
  run?: (ctx: RibbonContext) => void;
  options?: (ctx: RibbonContext) => RibbonOption[];
}

export const TABS: { id: TabId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "folder", label: "Folder" },
  { id: "vault", label: "Vault" },
  { id: "message", label: "Message" },
];

const kindIs = (c: RibbonContext, ...kinds: MailboxKind[]) => c.mailboxKind !== null && kinds.includes(c.mailboxKind);
const canRespond = (c: RibbonContext) => c.hasTargetMessage && !kindIs(c, "drafts", "trash");
const canArchive = (c: RibbonContext) => c.hasTargetMessage && !kindIs(c, "archive", "drafts", "trash");
const composing = (c: RibbonContext) => c.composerMode !== null;
const canAct = (c: RibbonContext) => composing(c) && !c.composerSending;

export const COMMANDS: RibbonCommand[] = [
  // Home
  { id: "new-message", tab: "home", group: "New", icon: "pencil", label: "New message",
    enabled: (c) => c.hasAccount, run: (c) => c.actions.newMessage() },
  { id: "reply", tab: "home", group: "Respond", icon: ACTION_ICON.reply, label: "Reply",
    enabled: canRespond, run: (c) => c.actions.reply() },
  { id: "reply-all", tab: "home", group: "Respond", icon: ACTION_ICON.replyAll, label: "Reply all",
    enabled: canRespond, run: (c) => c.actions.replyAll() },
  { id: "forward", tab: "home", group: "Respond", icon: ACTION_ICON.forward, label: "Forward",
    enabled: canRespond, run: (c) => c.actions.forward() },
  { id: "edit-draft", tab: "home", group: "Respond", icon: ACTION_ICON.editDraft, label: "Edit",
    visible: (c) => kindIs(c, "drafts"), enabled: (c) => c.hasTargetMessage, run: (c) => c.actions.editDraft() },
  { id: "archive", tab: "home", group: "Manage", icon: ACTION_ICON.archive, label: "Archive",
    enabled: canArchive, run: (c) => c.actions.archive() },
  { id: "delete", tab: "home", group: "Manage", icon: ACTION_ICON.delete, label: "Delete",
    enabled: (c) => c.hasTargetMessage, run: (c) => c.actions.deleteMessage() },
  { id: "move", tab: "home", group: "Manage", icon: "folder-input", label: "Move",
    enabled: (c) => c.hasOpenThread && c.otherMailboxes.length > 0,
    options: (c) => c.otherMailboxes.map((m) => ({ id: m.id, label: m.name, run: () => c.actions.move(m.id) })) },
  { id: "close-pane", tab: "home", group: "Manage", icon: ACTION_ICON.collapse, label: "Close pane",
    enabled: (c) => !c.readingPaneCollapsed, run: (c) => c.actions.closePane() },
  { id: "refresh", tab: "home", group: "Sync", icon: "refresh-cw", label: "Refresh",
    enabled: (c) => c.hasAccount && !c.syncing, run: (c) => c.actions.refresh() },

  // Folder
  { id: "new-folder", tab: "folder", group: "Folder", icon: "folder-plus", label: "New folder",
    enabled: (c) => c.hasAccount, run: (c) => c.actions.newFolder() },
  { id: "rename-folder", tab: "folder", group: "Folder", icon: "pencil", label: "Rename",
    enabled: (c) => kindIs(c, "custom"), run: (c) => c.actions.renameFolder() },
  { id: "delete-folder", tab: "folder", group: "Folder", icon: ACTION_ICON.delete, label: "Delete",
    enabled: (c) => kindIs(c, "custom"), run: (c) => c.actions.deleteFolder() },

  // Vault
  { id: "save-to-vault", tab: "vault", group: "Vault", icon: ACTION_ICON.saveToVault, label: "Save email to vault",
    enabled: (c) => c.hasTargetMessage, run: (c) => c.actions.saveToVault() },
  { id: "email-from-note", tab: "vault", group: "Vault", icon: "file-text", label: "Email from note",
    enabled: () => true, run: (c) => c.actions.emailFromNote() },
  { id: "email-with-note-attached", tab: "vault", group: "Vault", icon: "paperclip", label: "Email with note attached",
    enabled: () => true, run: (c) => c.actions.emailWithNoteAttached() },

  // Message (contextual)
  { id: "send", tab: "message", group: "Send", icon: "send", label: "Send",
    enabled: canAct, run: (c) => c.actions.send() },
  { id: "save-draft", tab: "message", group: "Send", icon: ACTION_ICON.saveToVault, label: "Save draft",
    enabled: (c) => canAct(c) && (c.composerMode === "new" || c.composerMode === "editDraft"),
    run: (c) => c.actions.saveDraft() },
  { id: "discard-draft", tab: "message", group: "Send", icon: ACTION_ICON.delete, label: "Discard",
    enabled: canAct, run: (c) => c.actions.discardDraft() },
  { id: "attach-note", tab: "message", group: "Insert", icon: "paperclip", label: "Attach note",
    enabled: (c) => canAct(c) && c.composerMode === "new", run: (c) => c.actions.attachNote() },
];

export function visibleTabs(ctx: RibbonContext): { id: TabId; label: string }[] {
  return TABS.filter((t) => t.id !== "message" || ctx.composerMode !== null);
}

export function commandsForTab(tab: TabId, ctx: RibbonContext): RibbonCommand[] {
  return COMMANDS.filter((c) => c.tab === tab && (c.visible?.(ctx) ?? true));
}

export function groupsForTab(tab: TabId, ctx: RibbonContext): string[] {
  return [...new Set(commandsForTab(tab, ctx).map((c) => c.group))];
}
