import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import App from "./App.svelte";
import type { ViewModel } from "./view-model";
import type { Mailbox } from "../providers/types";

export const MAIL_VIEW_TYPE = "obsidian-email-mail-view";

export interface ThreadMenuActions {
  /** Every mailbox except the active one — the Move destinations. */
  candidates: Mailbox[];
  onMove: (destinationMailboxId: string) => void;
  /** Any message in the thread is flagged. */
  flagged: boolean;
  onToggleFlag: () => void;
  /** The conversation is pinned. */
  pinned: boolean;
  onTogglePin: () => void;
}

export type ThreadContextMenuHandler = (evt: MouseEvent, actions: ThreadMenuActions) => void;

export type MailboxContextMenuHandler = (
  evt: MouseEvent,
  currentName: string,
  onRename: (newName: string) => void,
  onDelete: () => void,
) => void;

/** Vault-note → email flows, implemented in main.ts (they need Obsidian's
 *  workspace/vault) and shared between the command palette and the ribbon. */
export interface NoteCommands {
  composeFromNote: () => void;
  composeWithNoteAttached: () => void;
}

export class MailView extends ItemView {
  private app_?: ReturnType<typeof mount>;

  constructor(
    leaf: WorkspaceLeaf,
    private vm: ViewModel,
    private onAddAccount: () => void,
    private onThreadContextMenu: ThreadContextMenuHandler,
    private onMailboxContextMenu: MailboxContextMenuHandler,
    private noteCommands: NoteCommands,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return MAIL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Email";
  }

  getIcon(): string {
    return "mail";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.app_ = mount(App, {
      target: this.contentEl,
      props: {
        vm: this.vm,
        onAddAccount: this.onAddAccount,
        onThreadContextMenu: this.onThreadContextMenu,
        onMailboxContextMenu: this.onMailboxContextMenu,
        noteCommands: this.noteCommands,
      },
    });
    await this.vm.init();
  }

  async onClose(): Promise<void> {
    if (this.app_) unmount(this.app_);
    this.app_ = undefined;
  }
}
