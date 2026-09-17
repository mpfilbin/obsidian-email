import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import App from "./App.svelte";
import type { ViewModel } from "./view-model";
import type { Mailbox } from "../providers/types";

export const MAIL_VIEW_TYPE = "obsidian-email-mail-view";

export type ThreadContextMenuHandler = (
  evt: MouseEvent,
  candidates: Mailbox[],
  onMove: (destinationMailboxId: string) => void,
) => void;

export type MailboxContextMenuHandler = (
  evt: MouseEvent,
  currentName: string,
  onRename: (newName: string) => void,
  onDelete: () => void,
) => void;

export class MailView extends ItemView {
  private app_?: ReturnType<typeof mount>;

  constructor(
    leaf: WorkspaceLeaf,
    private vm: ViewModel,
    private onAddAccount: () => void,
    private onThreadContextMenu: ThreadContextMenuHandler,
    private onMailboxContextMenu: MailboxContextMenuHandler,
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
      },
    });
    await this.vm.init();
  }

  async onClose(): Promise<void> {
    if (this.app_) unmount(this.app_);
    this.app_ = undefined;
  }
}
