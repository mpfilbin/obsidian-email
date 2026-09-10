import { Plugin, requestUrl } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type { HttpPost } from "./auth/oauth-client";
import type { SecretStore } from "./auth/token-manager";
import { SettingsStore } from "./settings/settings-store";
import { PluginContext } from "./plugin-context";
import { MailView, MAIL_VIEW_TYPE } from "./view/mail-view";
import { EmailSettingTab } from "./settings/settings-tab";
import { makeObsidianHttp } from "./providers/obsidian-http";
import { Logger } from "./util/logger";

export default class EmailPlugin extends Plugin {
  private ctx?: PluginContext;
  private settingsStore?: SettingsStore;

  async onload(): Promise<void> {
    const settings = await SettingsStore.load(this);
    this.settingsStore = settings;
    const logger = new Logger("plugin", { debug: () => settings.get().prefs.debug });

    const http = makeObsidianHttp(requestUrl as never);

    // Form-url-encoded POST for OAuth token endpoints.
    const post: HttpPost = async (url, form) => {
      const body = new URLSearchParams(form).toString();
      const res = await requestUrl({
        url,
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        throw: false,
      });
      let json: unknown;
      try {
        json = res.json;
      } catch {
        json = undefined;
      }
      return { status: res.status, json };
    };

    // `this.app.secretStorage` (Obsidian >= 1.11.4) is synchronous; adapt it to
    // the async `SecretStore` shape the token manager expects.
    const secrets: SecretStore = {
      getSecret: async (id) => this.app.secretStorage.getSecret(id),
      setSecret: async (id, value) => {
        this.app.secretStorage.setSecret(id, value);
      },
    };

    // `electron` is an esbuild external; use it to open the system browser.
    const { shell } = require("electron") as {
      shell: { openExternal(url: string): Promise<void> };
    };
    const openExternal = (url: string): void => void shell.openExternal(url);

    // Ruling D: persist attachments into the configured vault folder, else hand
    // the blob to the renderer as a download.
    const saveBlob = async (blob: Blob, filename: string): Promise<void> => {
      const dir = settings.get().prefs.attachmentDir;
      if (dir) {
        const path = `${dir.replace(/\/+$/, "")}/${filename}`;
        await this.app.vault.adapter.writeBinary(path, await blob.arrayBuffer());
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    this.ctx = await PluginContext.create(
      settings,
      { http, secrets, post, openExternal, saveBlob },
      logger,
    );
    const ctx = this.ctx;

    this.registerView(
      MAIL_VIEW_TYPE,
      (leaf) => new MailView(leaf, ctx.vm, () => this.openSettings()),
    );

    this.addRibbonIcon("mail", "Open mail", () => void this.activateView());
    this.addCommand({ id: "open", name: "Open mail", callback: () => void this.activateView() });
    this.addSettingTab(new EmailSettingTab(this, ctx, settings));

    ctx.sync.start(settings.pollIntervalMs());
  }

  onunload(): void {
    this.ctx?.dispose();
    this.app.workspace.detachLeavesOfType(MAIL_VIEW_TYPE);
  }

  private openSettings(): void {
    const setting = (
      this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }
    ).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(MAIL_VIEW_TYPE)[0];
    const leaf: WorkspaceLeaf = existing ?? workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: MAIL_VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
  }
}
