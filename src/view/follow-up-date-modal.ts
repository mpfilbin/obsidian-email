import { App, Modal, Setting } from "obsidian";
import { followUpPresets, formatDateInput, parseDateInput } from "../util/follow-up";

/** Prompts for a custom follow-up date. Defaults to tomorrow; past dates are
 *  allowed (they simply read as overdue, as in Outlook). */
export class FollowUpDateModal extends Modal {
  private value: string;
  private errorEl?: HTMLElement;

  constructor(app: App, private onSubmit: (dueDate: number) => void) {
    super(app);
    this.value = formatDateInput(followUpPresets(Date.now())[1].dueDate);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Follow up on…" });

    new Setting(contentEl)
      .setName("Due date")
      .addText((t) => {
        t.inputEl.type = "date";
        t.setValue(this.value);
        t.onChange((v) => { this.value = v; });
        t.inputEl.focus();
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
      .addButton((b) => b.setCta().setButtonText("Flag").onClick(() => this.trySubmit()));
  }

  private trySubmit(): void {
    const due = parseDateInput(this.value);
    if (due === undefined) {
      this.errorEl?.setText("Pick a valid date.");
      return;
    }
    this.close();
    this.onSubmit(due);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
