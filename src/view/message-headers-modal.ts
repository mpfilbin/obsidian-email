import { App, Modal, Notice, Setting } from "obsidian";

/** "Message-id" -> "Message-Id" — Graph's header names arrive in their own
 *  original casing, but this plugin's header map lowercases every key (so
 *  lookups are case-insensitive), so a display form is rebuilt here. */
function displayName(key: string): string {
  return key.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join("-");
}

function formatHeaders(headers: Record<string, string>): string {
  return Object.entries(headers).map(([k, v]) => `${displayName(k)}: ${v}`).join("\n");
}

/** Read-only "view source"-style display of a message's raw internet
 *  headers, for diagnosing delivery/routing/authentication issues. */
export class MessageHeadersModal extends Modal {
  private text: string;

  constructor(app: App, private subject: string, headers: Record<string, string>) {
    super(app);
    this.text = Object.keys(headers).length ? formatHeaders(headers) : "No headers available for this message.";
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
            void navigator.clipboard.writeText(this.text).then(() => new Notice("Headers copied to clipboard."));
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
