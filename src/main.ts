import { Menu, Notice, Plugin, normalizePath, requestUrl } from "obsidian";
import type { TFile, Vault, WorkspaceLeaf } from "obsidian";
import type { HttpPost } from "./auth/oauth-client";
import type { SecretStore } from "./auth/token-manager";
import { SettingsStore } from "./settings/settings-store";
import { PluginContext } from "./plugin-context";
import {
  MailView,
  MAIL_VIEW_TYPE,
  type MailboxContextMenuHandler,
  type NoteCommands,
  type ThreadContextMenuHandler,
} from "./view/mail-view";
import type { OutgoingAttachment } from "./providers/types";
import { EmailSettingTab } from "./settings/settings-tab";
import { makeObsidianHttp } from "./providers/obsidian-http";
import { Logger } from "./util/logger";
import { safeAttachmentName, uniqueAttachmentPath } from "./util/safe-filename";
import { arrayBufferToBase64 } from "./util/base64";
import { SaveEmailModal } from "./view/save-email-modal";
import { FolderNameModal } from "./view/folder-name-modal";
import { NotePickerModal } from "./view/note-picker-modal";
import { renderNoteToHtml } from "./view/note-to-html";

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

    const showNotice = (message: string): void => {
      new Notice(message);
    };

    // "Any note from my vault": the active note if one's a Markdown file,
    // else a fuzzy-search picker over every note in the vault.
    const resolveNote = (onResolve: (file: TFile) => void, onCancel?: () => void): void => {
      const active = this.app.workspace.getActiveFile();
      if (active?.extension === "md") {
        onResolve(active);
        return;
      }
      new NotePickerModal(this.app, onResolve, onCancel).open();
    };

    const pickNoteAttachment = (): Promise<OutgoingAttachment | undefined> =>
      new Promise((resolve) => {
        resolveNote(
          (file) => {
            void (async () => {
              try {
                const contentBytes = arrayBufferToBase64(await this.app.vault.readBinary(file));
                resolve({ filename: file.name, mimeType: "text/markdown", contentBytes });
              } catch (err) {
                new Notice(`Couldn't attach "${file.name}": ${(err as Error).message}`);
                resolve(undefined);
              }
            })();
          },
          () => resolve(undefined),
        );
      });

    const showMailboxContextMenu: MailboxContextMenuHandler = (evt, currentName, onRename, onDelete) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("Rename")
          .setIcon("pencil")
          .onClick(() => {
            new FolderNameModal(
              this.app,
              { heading: "Rename folder", submitLabel: "Rename", defaultName: currentName },
              onRename,
            ).open();
          }),
      );
      menu.addItem((item) =>
        item
          .setTitle("Delete")
          .setIcon("trash-2")
          .setWarning(true)
          .onClick(() => onDelete()),
      );
      menu.showAtMouseEvent(evt);
    };

    // Obsidian's public Menu API has no submenu support, so "Move" opens a
    // second menu chained off the same click rather than nesting one — the
    // closest native-feeling equivalent. Pure presentation: the actual move
    // (with its unsaved-composer and reading-pane-collapse guards) happens
    // back in App.svelte via `onMove`, not here.
    //
    // The chained menu is positioned from the ORIGINAL right-click's
    // coordinates, captured up front, rather than from the "Move" item's own
    // click event: on desktop a MenuItem can be backed by a native OS menu,
    // whose click callback doesn't carry a real DOM mouse position — using it
    // for showAtMouseEvent put the submenu at (0, 0) instead of near the row.
    const showThreadContextMenu: ThreadContextMenuHandler = (evt, { candidates, onMove, flagged, onToggleFlag }) => {
      const position = { x: evt.clientX, y: evt.clientY };
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle(flagged ? "Remove flag" : "Flag")
          .setIcon(flagged ? "flag-off" : "flag")
          .onClick(() => onToggleFlag()),
      );
      menu.addItem((item) =>
        item
          .setTitle("Move")
          .setIcon("folder-input")
          .onClick(() => {
            const folderMenu = new Menu();
            for (const box of candidates) {
              folderMenu.addItem((folderItem) => folderItem.setTitle(box.name).onClick(() => onMove(box.id)));
            }
            folderMenu.showAtPosition(position);
          }),
      );
      menu.showAtMouseEvent(evt);
    };

    this.ctx = await PluginContext.create(
      settings,
      { http, secrets, post, openExternal, saveBlob, saveNote, promptFolderName, promptFolderRename, pickNoteAttachment, showNotice },
      logger,
    );
    const ctx = this.ctx;

    const noteCommands: NoteCommands = {
      composeFromNote: () => {
        resolveNote((file) => {
          void (async () => {
            try {
              const bodyHtml = await renderNoteToHtml(this.app, file);
              await this.activateView();
              ctx.vm.openComposeFromNote(file.basename, bodyHtml);
            } catch (err) {
              new Notice(`Couldn't create an email from "${file.basename}": ${(err as Error).message}`);
            }
          })();
        });
      },
      composeWithNoteAttached: () => {
        resolveNote((file) => {
          void (async () => {
            try {
              const contentBytes = arrayBufferToBase64(await this.app.vault.readBinary(file));
              await this.activateView();
              ctx.vm.openComposeWithAttachment({ filename: file.name, mimeType: "text/markdown", contentBytes });
            } catch (err) {
              new Notice(`Couldn't attach "${file.name}": ${(err as Error).message}`);
            }
          })();
        });
      },
    };

    this.registerView(
      MAIL_VIEW_TYPE,
      (leaf) =>
        new MailView(
          leaf,
          ctx.vm,
          () => this.openSettings(),
          showThreadContextMenu,
          showMailboxContextMenu,
          noteCommands,
        ),
    );

    this.addRibbonIcon("mail", "Open mail", () => void this.activateView());
    this.addCommand({ id: "open", name: "Open mail", callback: () => void this.activateView() });
    this.addCommand({ id: "compose-from-note", name: "Create email from note", callback: noteCommands.composeFromNote });
    this.addCommand({
      id: "compose-with-note-attached",
      name: "Create email with note attached",
      callback: noteCommands.composeWithNoteAttached,
    });
    this.addCommand({
      id: "open-contacts",
      name: "Open contacts",
      callback: () => {
        void (async () => {
          // The palette bypasses App's unsaved-content prompt, and entering
          // Contacts drops the composer — so refuse rather than lose a draft.
          if (ctx.vm.hasUnsavedComposerContent()) {
            new Notice("Finish or discard your unsent message before opening contacts.");
            return;
          }
          try {
            await this.activateView();
            ctx.vm.setMode("contacts");
          } catch (err) {
            new Notice(`Couldn't open contacts: ${(err as Error).message}`);
          }
        })();
      },
    });
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
