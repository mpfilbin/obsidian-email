import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import App from "./App.svelte";
import type { ViewModel } from "./view-model";

export const MAIL_VIEW_TYPE = "obsidian-email-mail-view";

export class MailView extends ItemView {
  private app_?: ReturnType<typeof mount>;

  constructor(
    leaf: WorkspaceLeaf,
    private vm: ViewModel,
    private onAddAccount: () => void,
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
      props: { vm: this.vm, onAddAccount: this.onAddAccount },
    });
    await this.vm.init();
  }

  async onClose(): Promise<void> {
    if (this.app_) unmount(this.app_);
    this.app_ = undefined;
  }
}
