import { App, Modal, Setting, normalizePath } from "obsidian";

/** Prompts for a vault-relative save path, pre-filled with a suggested
 *  filename at the vault root. Refuses to proceed onto an existing file
 *  rather than silently renaming — the user is actively naming this note,
 *  unlike an anonymous downloaded attachment. */
export class SaveEmailModal extends Modal {
  private path: string;
  private errorEl?: HTMLElement;

  constructor(app: App, defaultPath: string, private onSubmit: (path: string) => void) {
    super(app);
    this.path = defaultPath;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Save email to vault" });

    new Setting(contentEl)
      .setName("Note path")
      .setDesc("Vault-relative path, including the .md extension.")
      .addText((t) => {
        t.setValue(this.path);
        t.onChange((v) => { this.path = v; });
        t.inputEl.style.width = "100%";
        t.inputEl.focus();
        t.inputEl.select();
      });

    this.errorEl = contentEl.createEl("p", { cls: "oe-modal-error" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setCta()
          .setButtonText("Save")
          .onClick(() => void this.trySubmit()),
      );
  }

  private async trySubmit(): Promise<void> {
    const normalized = normalizePath(this.path.trim());
    if (!normalized || normalized.endsWith("/")) {
      this.setError("Enter a file name.");
      return;
    }
    if (await this.app.vault.adapter.exists(normalized)) {
      this.setError("A file already exists at that path.");
      return;
    }
    this.close();
    this.onSubmit(normalized);
  }

  private setError(message: string): void {
    this.errorEl?.setText(message);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
