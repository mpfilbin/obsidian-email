import { Notice, Plugin, normalizePath, requestUrl } from "obsidian";
import type { Vault, WorkspaceLeaf } from "obsidian";
import type { HttpPost } from "./auth/oauth-client";
import type { SecretStore } from "./auth/token-manager";
import { SettingsStore } from "./settings/settings-store";
import { PluginContext } from "./plugin-context";
import { MailView, MAIL_VIEW_TYPE } from "./view/mail-view";
import { EmailSettingTab } from "./settings/settings-tab";
import { makeObsidianHttp } from "./providers/obsidian-http";
import { Logger } from "./util/logger";
import { safeAttachmentName, uniqueAttachmentPath } from "./util/safe-filename";
import { SaveEmailModal } from "./view/save-email-modal";

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
    //
    // `filename` is attacker-controlled (MIME Content-Disposition / Graph's
    // attachment `name`), so it is reduced to a single inert path segment
    // before it can reach `writeBinary`, the join is re-checked against the
    // configured folder, and an existing file is never overwritten.
    const saveBlob = async (blob: Blob, filename: string): Promise<void> => {
      const dir = settings.get().prefs.attachmentDir;
      if (dir) {
        const { adapter } = this.app.vault;
        const baseDir = normalizePath(dir);
        const rel = normalizePath(`${baseDir}/${safeAttachmentName(filename)}`);
        const prefix = baseDir === "/" ? "" : `${baseDir}/`;
        if (!rel.startsWith(prefix) || rel.length <= prefix.length) {
          new Notice(`Refused to save "${filename}" outside the attachment folder.`);
          return;
        }
        const target = await uniqueAttachmentPath(rel, (p) => adapter.exists(p));
        await adapter.writeBinary(target, await blob.arrayBuffer());
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = safeAttachmentName(filename);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    // Walks each folder segment, creating any that don't yet exist, so
    // `vault.create` never fails on a missing parent directory.
    const ensureFolder = async (vault: Vault, folderPath: string): Promise<void> => {
      if (!folderPath || folderPath === "/") return;
      let cur = "";
      for (const seg of folderPath.split("/").filter(Boolean)) {
        cur = cur ? `${cur}/${seg}` : seg;
        if (!(await vault.adapter.exists(cur))) await vault.createFolder(cur);
      }
    };

    const saveNote = (defaultPath: string, content: string): void => {
      new SaveEmailModal(this.app, defaultPath, async (path) => {
        try {
          await ensureFolder(this.app.vault, path.split("/").slice(0, -1).join("/"));
          const file = await this.app.vault.create(path, content);
          new Notice(`Saved "${file.basename}".`);
          await this.app.workspace.getLeaf(true).openFile(file);
        } catch (err) {
          new Notice(`Couldn't save the note: ${(err as Error).message}`);
        }
      }).open();
    };

    this.ctx = await PluginContext.create(
      settings,
      { http, secrets, post, openExternal, saveBlob, saveNote },
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
