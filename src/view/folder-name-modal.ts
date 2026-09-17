import { App, Modal, Setting } from "obsidian";

/** Prompts for a mail folder's name — used both to create a new folder
 *  (empty, "Create") and to rename an existing one (pre-filled, "Rename"). */
export class FolderNameModal extends Modal {
  private name: string;
  private errorEl?: HTMLElement;

  constructor(
    app: App,
    private opts: { heading: string; submitLabel: string; defaultName?: string },
    private onSubmit: (name: string) => void,
  ) {
    super(app);
    this.name = opts.defaultName ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.opts.heading });

    new Setting(contentEl)
      .setName("Folder name")
      .addText((t) => {
        t.setValue(this.name);
        t.onChange((v) => { this.name = v; });
        t.inputEl.style.width = "100%";
        t.inputEl.focus();
        t.inputEl.select();
        t.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.trySubmit();
          }
        });
      });

    this.errorEl = contentEl.createEl("p", { cls: "oe-modal-error" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setCta()
          .setButtonText(this.opts.submitLabel)
          .onClick(() => this.trySubmit()),
      );
  }

  private trySubmit(): void {
    const trimmed = this.name.trim();
    if (!trimmed) {
      this.errorEl?.setText("Enter a folder name.");
      return;
    }
    this.close();
    this.onSubmit(trimmed);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
