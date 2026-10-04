import { Menu, Notice, Plugin, normalizePath, requestUrl } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";
import { SettingsStore } from "./settings/settings-store";
import { PluginContext } from "./plugin-context";
import { MailView, MAIL_VIEW_TYPE } from "./view/mail-view";
import { EmailSettingTab } from "./settings/settings-tab";
import { makeObsidianHttp } from "./providers/obsidian-http";
import { Logger } from "./util/logger";
import { SaveEmailModal } from "./view/save-email-modal";
import { FolderNameModal } from "./view/folder-name-modal";
import { FollowUpDateModal } from "./view/follow-up-date-modal";
import { NotePickerModal } from "./view/note-picker-modal";
import { renderNoteToHtml } from "./view/note-to-html";
import { printHtml } from "./view/print-html";
import { makeFormPost } from "./host/http-post";
import { makeSecretStore } from "./host/secret-store";
import { makeOpenEmailLink } from "./host/links";
import { makeMenus } from "./host/menus";
import { makeSaveBlob, makeSaveNote } from "./host/vault-io";
import { makeNoteCommands, makePickNoteAttachment, type NoteHost } from "./host/note-commands";
import { buildPaletteCommands } from "./host/palette";

/**
 * Composition root: wires Obsidian's APIs to the plugin. The logic lives in
 * `src/host/*` (injected, so it's unit-tested); this file only connects them.
 */
export default class EmailPlugin extends Plugin {
  private ctx?: PluginContext;
  private settingsStore?: SettingsStore;

  async onload(): Promise<void> {
    const settings = await SettingsStore.load(this);
    this.settingsStore = settings;
    const logger = new Logger("plugin", { debug: () => settings.get().prefs.debug });
    const notify = (message: string): void => void new Notice(message);

    const http = makeObsidianHttp(requestUrl as never);
    const post = makeFormPost(requestUrl as never);
    const secrets = makeSecretStore(this.app.secretStorage);

    // `electron` is an esbuild external; use it to open the system browser.
    const { shell } = require("electron") as {
      shell: { openExternal(url: string): Promise<void> };
    };
    const openExternal = (url: string): void => void shell.openExternal(url);
    const openEmailLink = makeOpenEmailLink(this.app, openExternal);

    const promptFolderName = (onSubmit: (name: string) => void): void => {
      new FolderNameModal(this.app, { heading: "New folder", submitLabel: "Create" }, onSubmit).open();
    };
    const promptFolderRename = (currentName: string, onSubmit: (name: string) => void): void => {
      new FolderNameModal(
        this.app,
        { heading: "Rename folder", submitLabel: "Rename", defaultName: currentName },
        onSubmit,
      ).open();
    };
    const promptFollowUpDate = (onSubmit: (dueDate: number) => void): void => {
      new FollowUpDateModal(this.app, onSubmit).open();
    };

    const saveBlob = makeSaveBlob({
      getAttachmentDir: () => settings.get().prefs.attachmentDir,
      adapter: this.app.vault.adapter,
      normalizePath,
      notify,
    });
    const saveNote = makeSaveNote({
      vault: this.app.vault,
      askPath: (defaultPath, onPath) => new SaveEmailModal(this.app, defaultPath, onPath).open(),
      openNote: (file) => this.app.workspace.getLeaf(true).openFile(file as TFile),
      notify,
    });

    const noteHost: NoteHost<TFile> = {
      activeFile: () => this.app.workspace.getActiveFile(),
      pickNote: (onResolve, onCancel) => new NotePickerModal(this.app, onResolve, onCancel).open(),
      readBinary: (file) => this.app.vault.readBinary(file),
      renderToHtml: (file) => renderNoteToHtml(this.app, file),
      activateView: () => this.activateView(),
      notify,
      // The view-model doesn't exist until the context below is built.
      openComposeFromNote: (subject, html) => this.ctx!.vm.openComposeFromNote(subject, html),
      openComposeWithAttachment: (attachment) => this.ctx!.vm.openComposeWithAttachment(attachment),
    };
    const pickNoteAttachment = makePickNoteAttachment(noteHost);
    const noteCommands = makeNoteCommands(noteHost);

    const { showLinkContextMenu, showMailboxContextMenu, showThreadContextMenu } = makeMenus({
      newMenu: () => new Menu(),
      openExternal,
      promptFolderRename,
    });

    this.ctx = await PluginContext.create(
      settings,
      {
        http, secrets, post, openExternal, openEmailLink, showLinkContextMenu, saveBlob, saveNote, printHtml,
        promptFolderName, promptFollowUpDate, promptFolderRename, pickNoteAttachment, showNotice: notify,
      },
      logger,
    );
    const ctx = this.ctx;

    this.registerView(
      MAIL_VIEW_TYPE,
      (leaf) =>
        new MailView(leaf, ctx.vm, () => this.openSettings(), showThreadContextMenu, showMailboxContextMenu, noteCommands),
    );

    this.addRibbonIcon("mail", "Open mail", () => void this.activateView());
    for (const command of buildPaletteCommands({ activateView: () => this.activateView(), noteCommands, notify, vm: ctx.vm })) {
      this.addCommand(command);
    }
    this.addSettingTab(new EmailSettingTab(this, ctx, settings));

    ctx.sync.start(settings.pollIntervalMs());
    ctx.startContacts();
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
