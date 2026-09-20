import { PluginSettingTab, Setting, Notice } from "obsidian";
import type { Plugin } from "obsidian";
import type { PluginContext } from "../plugin-context";
import type { SettingsStore } from "./settings-store";

export interface ConnectInput {
  clientId: string;
}

/**
 * DOM-free core of the "Connect" button: validate the inputs, run the OAuth
 * flow, and turn the outcome into a message the caller shows with a `Notice`.
 */
export async function handleConnect(
  ctx: Pick<PluginContext, "addAccountFlow">,
  input: ConnectInput,
): Promise<{ ok: boolean; message: string }> {
  if (!input.clientId.trim()) return { ok: false, message: "Client ID is required." };
  try {
    const account = await ctx.addAccountFlow({ kind: "ms-graph", clientId: input.clientId });
    return { ok: true, message: `Connected ${account.email}.` };
  } catch (err) {
    return { ok: false, message: `Could not connect: ${(err as Error).message}` };
  }
}

/** DOM-free core of the "Clear local cache" button (mail and contacts). */
export async function handleClearCache(ctx: Pick<PluginContext, "clearLocalCache">): Promise<void> {
  await ctx.clearLocalCache();
}

const POLL_OPTIONS: Array<[string, string]> = [
  ["", "Manual only"],
  ["1", "1 minute"],
  ["5", "5 minutes"],
  ["15", "15 minutes"],
  ["30", "30 minutes"],
  ["60", "60 minutes"],
];

export class EmailSettingTab extends PluginSettingTab {
  // "Add account" form state lives on the instance, NOT in `display()`, so a
  // re-entrant `display()` call (e.g. after Connect) doesn't lose what the
  // user typed.
  private addClientId = "";

  constructor(
    plugin: Plugin,
    private ctx: PluginContext,
    private settings: SettingsStore,
  ) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const cfg = this.settings.get();

    containerEl.createEl("h2", { text: "Accounts" });
    if (cfg.accounts.length === 0) {
      containerEl.createEl("p", {
        text: "No accounts yet. Add one below to start reading mail.",
      });
    }
    for (const a of cfg.accounts) {
      const status = this.ctx.sync.getState(a.id).status;
      new Setting(containerEl)
        .setName(a.email)
        .setDesc(status)
        .addButton((b) =>
          b.setButtonText("Re-authenticate").onClick(async () => {
            const r = await this.ctx.reauthAccount(a.id);
            new Notice(r.message);
            this.display();
          }),
        )
        .addButton((b) =>
          b
            .setButtonText("Remove")
            .setWarning()
            .onClick(async () => {
              await this.ctx.removeAccountFlow(a.id);
              new Notice(`Removed ${a.email}.`);
              this.display();
            }),
        );
    }

    containerEl.createEl("h2", { text: "Add Microsoft 365 account" });
    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("The Application (client) ID from your Microsoft Entra app registration.")
      .addText((t) => t.setValue(this.addClientId).onChange((v) => (this.addClientId = v)));
    new Setting(containerEl).addButton((b) =>
      b
        .setCta()
        .setButtonText("Connect")
        .onClick(async () => {
          const r = await handleConnect(this.ctx, { clientId: this.addClientId });
          new Notice(r.message);
          if (r.ok) {
            this.addClientId = "";
            this.display();
          }
        }),
    );

    containerEl.createEl("h2", { text: "Preferences" });
    new Setting(containerEl).setName("Check for new mail").addDropdown((d) => {
      for (const [value, label] of POLL_OPTIONS) d.addOption(value, label);
      d.setValue(cfg.prefs.pollMinutes ? String(cfg.prefs.pollMinutes) : "");
      d.onChange(async (v) => {
        await this.settings.updatePrefs({ pollMinutes: v ? Number(v) : null });
        this.ctx.applyPollInterval();
      });
    });
    new Setting(containerEl)
      .setName("Load remote images automatically")
      .setDesc("Off by default — remote images can track when mail is opened.")
      .addToggle((t) =>
        t
          .setValue(cfg.prefs.autoLoadImages)
          .onChange((v) => this.settings.updatePrefs({ autoLoadImages: v })),
      );
    new Setting(containerEl)
      .setName("Show ribbon")
      .setDesc("The tabbed action bar above the mail view. Turning this off removes the only buttons for replying, sending, saving to your vault and creating folders — use it for troubleshooting only. Takes effect the next time the mail view opens or refreshes.")
      .addToggle((t) =>
        t
          .setValue(cfg.prefs.ribbonEnabled)
          .onChange((v) => this.settings.updatePrefs({ ribbonEnabled: v })),
      );
    new Setting(containerEl)
      .setName("Collapse ribbon by default")
      .setDesc("Start with only the tab strip visible. Double-click a tab to expand or collapse.")
      .addToggle((t) =>
        t
          .setValue(cfg.prefs.ribbonCollapsedByDefault)
          .onChange((v) => this.settings.updatePrefs({ ribbonCollapsedByDefault: v })),
      );
    new Setting(containerEl)
      .setName("Attachment save folder")
      .setDesc("Vault-relative path. Blank = ask each time.")
      .addText((t) =>
        t
          .setValue(cfg.prefs.attachmentDir ?? "")
          .onChange((v) => this.settings.updatePrefs({ attachmentDir: v || null })),
      );
    new Setting(containerEl).setName("Default account").addDropdown((d) => {
      d.addOption("", "First account");
      for (const a of cfg.accounts) d.addOption(a.id, a.email);
      d.setValue(cfg.prefs.defaultAccountId ?? "");
      d.onChange((v) => this.settings.updatePrefs({ defaultAccountId: v || null }));
    });
    new Setting(containerEl)
      .setName("Debug logging")
      .addToggle((t) =>
        t.setValue(cfg.prefs.debug).onChange((v) => this.settings.updatePrefs({ debug: v })),
      );

    containerEl.createEl("h2", { text: "Danger zone" });
    new Setting(containerEl)
      .setName("Clear local cache")
      .setDesc("Removes cached mail and contacts. Accounts and tokens are kept; both re-sync.")
      .addButton((b) =>
        b
          .setWarning()
          .setButtonText("Clear cache")
          .onClick(async () => {
            await handleClearCache(this.ctx);
            new Notice("Local cache cleared.");
          }),
      );
  }
}
