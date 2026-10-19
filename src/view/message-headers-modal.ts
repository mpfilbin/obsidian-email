import { App, Modal, Notice, Setting } from "obsidian";
import type { MessageHeader } from "../providers/types";

function formatHeaders(headers: MessageHeader[]): string {
  return headers.map((h) => `${h.name}: ${h.value}`).join("\n");
}

/** Read-only "view source"-style display of a message's raw internet
 *  headers, for diagnosing delivery/routing/authentication issues. */
export class MessageHeadersModal extends Modal {
  private text: string;

  constructor(app: App, private subject: string, headers: MessageHeader[]) {
    super(app);
    this.text = headers.length ? formatHeaders(headers) : "No headers available for this message.";
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("oe-headers-modal");
    contentEl.createEl("h3", { text: `Headers: ${this.subject}` });
    contentEl.createEl("pre", { cls: "oe-headers-text", text: this.text });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Close").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setCta()
          .setButtonText("Copy")
          .onClick(() => {
            navigator.clipboard.writeText(this.text).then(
              () => new Notice("Headers copied to clipboard."),
              () => new Notice("Couldn't copy headers to the clipboard."),
            );
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
