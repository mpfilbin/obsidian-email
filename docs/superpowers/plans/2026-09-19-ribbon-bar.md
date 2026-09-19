# Ribbon Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Office-style tabbed ribbon (Home / Folder / Vault + contextual Message tab) to the mail view that becomes the single home for mail actions, replacing the sidebar, reading-pane and composer button rows.

**Architecture:** A declarative registry (`src/view/ribbon/registry.ts`, pure data + predicates) rendered by generic Svelte components. `App.svelte` builds one `RibbonContext` from view state plus its existing guarded handlers and passes it down; the registry only decides enabled/visible and which action to call. No `obsidian` imports outside the existing host-layer files.

**Tech Stack:** TypeScript, Svelte 5 (runes), Obsidian plugin API, vitest + jsdom (`obsidian` aliased to `tests/stubs/obsidian.ts`).

**Spec:** `docs/superpowers/specs/2026-09-19-ribbon-bar-design.md`

## Global Constraints

- `.svelte` files and `view-model.ts` never import from `"obsidian"`. Only `src/main.ts`, `src/plugin-context.ts` and the plain-`.ts` host files in `src/view/` (`icon-action.ts`, `mail-view.ts`, `refresh-toast.ts`, `save-email-modal.ts`, `folder-name-modal.ts`, `note-picker-modal.ts`, `note-to-html.ts`) may. Icons in Svelte go through `use:icon` from `src/view/icon-action.ts`.
- Host capabilities reach the view model only via `ViewModelDeps` (`main.ts` → `ContextHostDeps` → `PluginContext.create` → `ViewModelDeps`).
- Guard logic (`requestSwitch`, `requestRowAction`, `requestDelete`, `requestDeleteMailbox`, unsaved-composer prompt) stays in `App.svelte`. The registry never re-implements it.
- `tests/` is outside `tsconfig.json`'s scope: `npx tsc -noEmit -skipLibCheck` does NOT type-check tests, so run the suite.
- Ribbon buttons carry `data-action="<command id>"`. Existing per-row buttons in `ThreadRow` (`.oe-thread-actions`) also use `data-action="archive"|"delete"`; tests must scope selectors (`.oe-ribbon [data-action=…]` vs `.oe-thread-actions [data-action=…]`).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- The Refresh button in `SearchBar` stays (search-adjacent); the ribbon adds its own Refresh. Decided during planning; not listed in the spec's removed UI.
- `ribbonEnabled` / `ribbonCollapsedByDefault` are re-read by `syncPrefs()` (init, `selectAccount`, `refresh`), same staleness model as `autoLoadImages`.

---

### Task 1: Ribbon prefs and settings toggles

**Files:**
- Modify: `src/settings/settings-store.ts`
- Modify: `src/settings/settings-tab.ts` (after the "Load remote images automatically" setting, ~line 127)
- Test: `tests/settings/settings-store.test.ts`

**Interfaces:**
- Produces: `Prefs.ribbonEnabled: boolean` (default `true`), `Prefs.ribbonCollapsedByDefault: boolean` (default `false`).

- [ ] **Step 1: Write the failing test** — append inside `describe("SettingsStore", …)` in `tests/settings/settings-store.test.ts`:

```ts
  it("defaults the ribbon to enabled and expanded, and persists changes", async () => {
    const h = host();
    const s = await SettingsStore.load(h);
    expect(s.get().prefs.ribbonEnabled).toBe(true);
    expect(s.get().prefs.ribbonCollapsedByDefault).toBe(false);
    await s.updatePrefs({ ribbonEnabled: false, ribbonCollapsedByDefault: true });
    const s2 = await SettingsStore.load(h);
    expect(s2.get().prefs.ribbonEnabled).toBe(false);
    expect(s2.get().prefs.ribbonCollapsedByDefault).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/settings/settings-store.test.ts`
Expected: FAIL (`ribbonEnabled` undefined).

- [ ] **Step 3: Implement** — in `src/settings/settings-store.ts` add the two fields to `Prefs` and `DEFAULT_SETTINGS.prefs`:

```ts
export interface Prefs {
  pollMinutes: number | null;
  autoLoadImages: boolean;
  attachmentDir: string | null;
  syncWindowDays: number;
  defaultAccountId: string | null;
  debug: boolean;
  ribbonEnabled: boolean;
  ribbonCollapsedByDefault: boolean;
}
```
```ts
    debug: false,
    ribbonEnabled: true,
    ribbonCollapsedByDefault: false,
  },
```

In `src/settings/settings-tab.ts`, immediately after the "Load remote images automatically" `new Setting(...)` block, add:

```ts
    new Setting(containerEl)
      .setName("Show ribbon")
      .setDesc("The tabbed action bar above the mail view. Takes effect the next time the mail view opens or refreshes.")
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
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx tsc -noEmit -skipLibCheck && npx vitest run tests/settings`
Expected: PASS (the existing `toEqual(DEFAULT_SETTINGS)` test still passes because it compares to the same object).

- [ ] **Step 5: Commit**

```bash
git add src/settings/settings-store.ts src/settings/settings-tab.ts tests/settings/settings-store.test.ts
git commit -m "feat: add ribbon show/collapse preferences

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: ViewModel — ribbon prefs in state, rename prompt, attach-note

**Files:**
- Modify: `src/view/view-model.ts`
- Modify: `src/plugin-context.ts` (`ContextHostDeps` + `ViewModelDeps` wiring, next to `showNotice`)
- Modify: `tests/view/view-model.test.ts` (`build()` helper + new tests)
- Modify: `tests/plugin-context.test.ts` (`hostDeps()`)

**Interfaces:**
- Produces on `ViewState`: `ribbonEnabled: boolean`, `ribbonCollapsedByDefault: boolean` (kept current by `syncPrefs()`).
- Produces on `ViewModelDeps` (and `ContextHostDeps`): `promptFolderRename: (currentName: string, onSubmit: (name: string) => void) => void;` and `pickNoteAttachment: () => Promise<OutgoingAttachment | undefined>;`
- Produces on `ViewModel`: `requestRenameMailbox(id: string): void`, `addComposerAttachment(att: OutgoingAttachment): void`, `requestAttachNote(): Promise<void>`.

- [ ] **Step 1: Write failing tests.** In `tests/view/view-model.test.ts`, extend `build()` so the deps include the two new host functions and return them:

```ts
  const showNotice = vi.fn();
  const promptFolderRename = vi.fn();
  const pickNoteAttachment = vi.fn();
  const vm = new ViewModel({
    cache, sync, settings, getProvider: () => provider, isOnline: () => true,
    openExternal: () => {}, saveBlob: async () => {}, saveNote: () => {},
    promptFolderName: () => {}, promptFolderRename, pickNoteAttachment, showNotice,
  });
  return { cache, provider, sync, settings, vm, showNotice, promptFolderRename, pickNoteAttachment };
```

Every other `new ViewModel({...})` in that file (offlineVm, saveMessageToVault, requestCreateMailbox blocks) gets `promptFolderRename: () => {}, pickNoteAttachment: async () => undefined,` added next to its existing `promptFolderName`.

Append these tests (new `describe` blocks at end of file):

```ts
describe("ViewModel — ribbon prefs", () => {
  it("mirrors ribbon prefs into state on selectAccount", async () => {
    const ctx = await build();
    await ctx.settings.updatePrefs({ ribbonEnabled: false, ribbonCollapsedByDefault: true });
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.vm.init();
    expect(ctx.vm.getState().ribbonEnabled).toBe(false);
    expect(ctx.vm.getState().ribbonCollapsedByDefault).toBe(true);
  });

  it("defaults to ribbon enabled and expanded before any account is selected", async () => {
    const ctx = await build();
    expect(ctx.vm.getState().ribbonEnabled).toBe(true);
    expect(ctx.vm.getState().ribbonCollapsedByDefault).toBe(false);
  });
});

describe("ViewModel — requestRenameMailbox", () => {
  it("prompts with the folder's current name and renames on submit", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    ctx.provider.addMailbox({ id: "PROJ", name: "Project X", kind: "custom" });
    await ctx.cache.putMailboxes("a1", [{ id: "PROJ", name: "Project X", kind: "custom" }]);
    await ctx.vm.init();

    ctx.vm.requestRenameMailbox("PROJ");
    expect(ctx.promptFolderRename).toHaveBeenCalledWith("Project X", expect.any(Function));
    ctx.promptFolderRename.mock.calls[0][1]("Project Y");
    await vi.waitFor(() => {
      expect(ctx.vm.getState().mailboxes.find((m) => m.id === "PROJ")?.name).toBe("Project Y");
    });
  });

  it("does nothing for an unknown mailbox id", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.requestRenameMailbox("nope");
    expect(ctx.promptFolderRename).not.toHaveBeenCalled();
  });
});

describe("ViewModel — attach a note to the open composer", () => {
  const att = { filename: "n.md", mimeType: "text/markdown", contentBytes: "aGk=" };

  it("addComposerAttachment appends to the open composer", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.vm.addComposerAttachment(att);
    expect(ctx.vm.getState().composer?.attachments).toEqual([att]);
  });

  it("addComposerAttachment is a no-op with no composer open", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.addComposerAttachment(att);
    expect(ctx.vm.getState().composer).toBeNull();
  });

  it("requestAttachNote attaches whatever the host picker resolves with", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.pickNoteAttachment.mockResolvedValue(att);
    await ctx.vm.requestAttachNote();
    expect(ctx.vm.getState().composer?.attachments).toEqual([att]);
  });

  it("requestAttachNote leaves the composer alone when the picker yields nothing", async () => {
    const ctx = await build();
    await ctx.vm.init();
    ctx.vm.openNewMessage();
    ctx.pickNoteAttachment.mockResolvedValue(undefined);
    await ctx.vm.requestAttachNote();
    expect(ctx.vm.getState().composer?.attachments).toEqual([]);
  });
});
```

In `tests/plugin-context.test.ts` `hostDeps()` add `promptFolderRename: vi.fn(), pickNoteAttachment: vi.fn(),` next to `showNotice: vi.fn(),`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/view-model.test.ts`
Expected: FAIL (`requestRenameMailbox`/`addComposerAttachment` not functions, new state fields undefined).

- [ ] **Step 3: Implement in `src/view/view-model.ts`.**

Add to `ViewState` (after `openMessages`): 
```ts
  /** Mirror `prefs.ribbonEnabled` / `prefs.ribbonCollapsedByDefault`. */
  ribbonEnabled: boolean;
  ribbonCollapsedByDefault: boolean;
```
Initial state in the `private state` literal:
```ts
    openThreadId: null, openMessages: [],
    ribbonEnabled: true, ribbonCollapsedByDefault: false,
    composer: null,
```
Add to `ViewModelDeps` (after `promptFolderName`):
```ts
  /** Prompts for a folder's new name, pre-filled with `currentName`. */
  promptFolderRename: (currentName: string, onSubmit: (name: string) => void) => void;
  /** Lets the user pick a vault note and resolves with it as an attachment,
   *  or `undefined` if the note couldn't be read. May never resolve if the
   *  picker is dismissed. */
  pickNoteAttachment: () => Promise<OutgoingAttachment | undefined>;
```
Replace `syncPrefs`:
```ts
  private syncPrefs(): void {
    const { autoLoadImages, ribbonEnabled, ribbonCollapsedByDefault } = this.deps.settings.get().prefs;
    if (
      autoLoadImages !== this.state.autoLoadImages ||
      ribbonEnabled !== this.state.ribbonEnabled ||
      ribbonCollapsedByDefault !== this.state.ribbonCollapsedByDefault
    ) {
      this.set({ autoLoadImages, ribbonEnabled, ribbonCollapsedByDefault });
    }
  }
```
Add next to `requestCreateMailbox`:
```ts
  /** Prompts (via the host) for a new name for `id`, pre-filled with its
   *  current one, then renames it. */
  requestRenameMailbox(id: string): void {
    const box = this.state.mailboxes.find((m) => m.id === id);
    if (!box) return;
    this.deps.promptFolderRename(box.name, (name) => { void this.renameMailbox(id, name); });
  }
```
Add next to `removeComposerAttachment`:
```ts
  addComposerAttachment(attachment: OutgoingAttachment): void {
    if (!this.state.composer) return;
    this.set({ composer: { ...this.state.composer, attachments: [...this.state.composer.attachments, attachment] } });
  }

  /** Asks the host to pick a note and attaches it to the open composer. */
  async requestAttachNote(): Promise<void> {
    const attachment = await this.deps.pickNoteAttachment();
    if (attachment) this.addComposerAttachment(attachment);
  }
```

In `src/plugin-context.ts`: add to `ContextHostDeps`:
```ts
  /** Prompts for a folder's new name, pre-filled. */
  promptFolderRename: (currentName: string, onSubmit: (name: string) => void) => void;
  /** Picks a vault note and reads it as an attachment. */
  pickNoteAttachment: () => Promise<OutgoingAttachment | undefined>;
```
(add `OutgoingAttachment` to that file's `../providers/types` type import, or add `import type { OutgoingAttachment } from "./providers/types";` if none exists), and in the `new ViewModel({...})` call next to `showNotice: host.showNotice,`:
```ts
      promptFolderRename: host.promptFolderRename,
      pickNoteAttachment: host.pickNoteAttachment,
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/view/view-model.test.ts tests/plugin-context.test.ts`
Expected: PASS. (`tsc` will fail until Task 3 supplies `main.ts` host functions — do NOT run `tsc` yet; it is covered by Task 3's Step 4.)

- [ ] **Step 5: Commit**

```bash
git add src/view/view-model.ts src/plugin-context.ts tests/view/view-model.test.ts tests/plugin-context.test.ts
git commit -m "feat: view-model support for ribbon prefs, folder rename prompt and attach-note

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Host layer — shared note functions, rename prompt, MailView props

**Files:**
- Modify: `src/main.ts`
- Modify: `src/view/mail-view.ts`

**Interfaces:**
- Consumes: `ContextHostDeps.promptFolderRename`, `ContextHostDeps.pickNoteAttachment` (Task 2).
- Produces in `mail-view.ts`: `export interface NoteCommands { composeFromNote: () => void; composeWithNoteAttached: () => void; }` and `MailView` constructor gains a final `noteCommands: NoteCommands` parameter, forwarded to `<App>` as prop `noteCommands`.

No unit tests: these are thin Obsidian-API wrappers (matches the existing convention for `main.ts`, `mail-view.ts`, modals). Verified by `tsc`, the full suite, and Task 8's manual pass.

- [ ] **Step 1: `src/view/mail-view.ts`** — add after `MailboxContextMenuHandler`:

```ts
/** Vault-note → email flows, implemented in main.ts (they need Obsidian's
 *  workspace/vault) and shared between the command palette and the ribbon. */
export interface NoteCommands {
  composeFromNote: () => void;
  composeWithNoteAttached: () => void;
}
```
Constructor gets `private noteCommands: NoteCommands,` after `onMailboxContextMenu`, and the mounted props gain `noteCommands: this.noteCommands,`.

- [ ] **Step 2: `src/main.ts`.**

Update the `mail-view` import to also pull `type NoteCommands`, and add `import type { OutgoingAttachment } from "./providers/types";` and (if not already imported) nothing else new.

Add next to `promptFolderName`:
```ts
    const promptFolderRename = (currentName: string, onSubmit: (name: string) => void): void => {
      new FolderNameModal(
        this.app,
        { heading: "Rename folder", submitLabel: "Rename", defaultName: currentName },
        onSubmit,
      ).open();
    };
```
Add after `resolveNote` (still before `PluginContext.create`):
```ts
    const pickNoteAttachment = (): Promise<OutgoingAttachment | undefined> =>
      new Promise((resolve) => {
        resolveNote((file) => {
          void (async () => {
            try {
              const contentBytes = arrayBufferToBase64(await this.app.vault.readBinary(file));
              resolve({ filename: file.name, mimeType: "text/markdown", contentBytes });
            } catch (err) {
              new Notice(`Couldn't attach "${file.name}": ${(err as Error).message}`);
              resolve(undefined);
            }
          })();
        });
      });
```
Pass both to `PluginContext.create`'s host object: `{ http, secrets, post, openExternal, saveBlob, saveNote, promptFolderName, promptFolderRename, pickNoteAttachment, showNotice }`.

After `const ctx = this.ctx;` replace the two inline `addCommand` bodies with shared functions:
```ts
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
```
`registerView` becomes `new MailView(leaf, ctx.vm, () => this.openSettings(), showThreadContextMenu, showMailboxContextMenu, noteCommands)`, and the two palette commands become:
```ts
    this.addCommand({ id: "compose-from-note", name: "Create email from note", callback: noteCommands.composeFromNote });
    this.addCommand({ id: "compose-with-note-attached", name: "Create email with note attached", callback: noteCommands.composeWithNoteAttached });
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: FAIL only on `App.svelte` not yet accepting `noteCommands` if svelte-check runs; `tsc` alone does not type-check `.svelte` props, so expected PASS. If it fails, fix before continuing.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/view/mail-view.ts
git commit -m "feat: share note-to-email flows between palette and mail view; add folder rename and note attach host prompts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Ribbon registry (pure)

**Files:**
- Create: `src/view/ribbon/registry.ts`
- Test: `tests/view/ribbon-registry.test.ts`

**Interfaces:**
- Produces (exact):
```ts
export type TabId = "home" | "folder" | "vault" | "message";
export interface RibbonMailboxOption { id: string; name: string }
export interface RibbonActions {
  newMessage(): void; reply(): void; replyAll(): void; forward(): void; editDraft(): void;
  archive(): void; deleteMessage(): void; move(destinationMailboxId: string): void;
  closePane(): void; refresh(): void;
  newFolder(): void; renameFolder(): void; deleteFolder(): void;
  saveToVault(): void; emailFromNote(): void; emailWithNoteAttached(): void;
  send(): void; saveDraft(): void; discardDraft(): void; attachNote(): void;
}
export interface RibbonContext {
  hasAccount: boolean; hasOpenThread: boolean; hasTargetMessage: boolean;
  mailboxKind: MailboxKind | null; otherMailboxes: RibbonMailboxOption[];
  readingPaneCollapsed: boolean; syncing: boolean;
  composerMode: ComposerState["mode"] | null; composerSending: boolean;
  actions: RibbonActions;
}
export interface RibbonOption { id: string; label: string; run: () => void }
export interface RibbonCommand {
  id: string; tab: TabId; group: string; icon: string; label: string;
  enabled: (ctx: RibbonContext) => boolean;
  visible?: (ctx: RibbonContext) => boolean;
  run?: (ctx: RibbonContext) => void;
  options?: (ctx: RibbonContext) => RibbonOption[];
}
export const TABS: { id: TabId; label: string }[];
export const COMMANDS: RibbonCommand[];
export function visibleTabs(ctx: RibbonContext): { id: TabId; label: string }[];
export function commandsForTab(tab: TabId, ctx: RibbonContext): RibbonCommand[];
export function groupsForTab(tab: TabId, ctx: RibbonContext): string[];
```

- [ ] **Step 1: Write the failing test** — create `tests/view/ribbon-registry.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  COMMANDS, commandsForTab, groupsForTab, visibleTabs,
  type RibbonActions, type RibbonContext,
} from "../../src/view/ribbon/registry";

function actions(): RibbonActions {
  const names = [
    "newMessage", "reply", "replyAll", "forward", "editDraft", "archive", "deleteMessage", "move",
    "closePane", "refresh", "newFolder", "renameFolder", "deleteFolder", "saveToVault",
    "emailFromNote", "emailWithNoteAttached", "send", "saveDraft", "discardDraft", "attachNote",
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as unknown as RibbonActions;
}

function ctx(over: Partial<RibbonContext> = {}): RibbonContext {
  return {
    hasAccount: true, hasOpenThread: true, hasTargetMessage: true, mailboxKind: "inbox",
    otherMailboxes: [{ id: "ARCH", name: "Archive" }], readingPaneCollapsed: false, syncing: false,
    composerMode: null, composerSending: false, actions: actions(), ...over,
  };
}

const cmd = (id: string) => COMMANDS.find((c) => c.id === id)!;
const enabled = (id: string, c: RibbonContext) => cmd(id).enabled(c);

describe("ribbon registry — tabs", () => {
  it("hides the Message tab unless a composer is open", () => {
    expect(visibleTabs(ctx()).map((t) => t.id)).toEqual(["home", "folder", "vault"]);
    expect(visibleTabs(ctx({ composerMode: "new" })).map((t) => t.id)).toEqual(["home", "folder", "vault", "message"]);
  });

  it("groups Home commands as New, Respond, Manage, Sync", () => {
    expect(groupsForTab("home", ctx())).toEqual(["New", "Respond", "Manage", "Sync"]);
  });

  it("every command id is unique", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("ribbon registry — Home enabled rules", () => {
  it("respond commands need a target message and are disabled in Drafts and Trash", () => {
    for (const id of ["reply", "reply-all", "forward"]) {
      expect(enabled(id, ctx())).toBe(true);
      expect(enabled(id, ctx({ hasTargetMessage: false }))).toBe(false);
      expect(enabled(id, ctx({ mailboxKind: "drafts" }))).toBe(false);
      expect(enabled(id, ctx({ mailboxKind: "trash" }))).toBe(false);
    }
  });

  it("Edit is only visible in Drafts, and needs a target", () => {
    expect(commandsForTab("home", ctx()).some((c) => c.id === "edit-draft")).toBe(false);
    const drafts = ctx({ mailboxKind: "drafts" });
    expect(commandsForTab("home", drafts).some((c) => c.id === "edit-draft")).toBe(true);
    expect(enabled("edit-draft", drafts)).toBe(true);
    expect(enabled("edit-draft", ctx({ mailboxKind: "drafts", hasTargetMessage: false }))).toBe(false);
  });

  it("Archive is disabled in Archive, Drafts and Trash", () => {
    expect(enabled("archive", ctx())).toBe(true);
    for (const kind of ["archive", "drafts", "trash"] as const) {
      expect(enabled("archive", ctx({ mailboxKind: kind }))).toBe(false);
    }
  });

  it("Delete needs a target message", () => {
    expect(enabled("delete", ctx())).toBe(true);
    expect(enabled("delete", ctx({ hasTargetMessage: false }))).toBe(false);
  });

  it("Move lists the other mailboxes and needs an open thread", () => {
    expect(enabled("move", ctx())).toBe(true);
    expect(enabled("move", ctx({ hasOpenThread: false }))).toBe(false);
    expect(enabled("move", ctx({ otherMailboxes: [] }))).toBe(false);
    const c = ctx();
    const opts = cmd("move").options!(c);
    expect(opts.map((o) => o.label)).toEqual(["Archive"]);
    opts[0].run();
    expect(c.actions.move).toHaveBeenCalledWith("ARCH");
  });

  it("Close pane is enabled only while the reading pane is open", () => {
    expect(enabled("close-pane", ctx())).toBe(true);
    expect(enabled("close-pane", ctx({ readingPaneCollapsed: true }))).toBe(false);
  });

  it("Refresh is disabled while syncing or with no account", () => {
    expect(enabled("refresh", ctx())).toBe(true);
    expect(enabled("refresh", ctx({ syncing: true }))).toBe(false);
    expect(enabled("refresh", ctx({ hasAccount: false }))).toBe(false);
  });

  it("New message needs an account", () => {
    expect(enabled("new-message", ctx())).toBe(true);
    expect(enabled("new-message", ctx({ hasAccount: false }))).toBe(false);
  });
});

describe("ribbon registry — Folder and Vault", () => {
  it("Rename and Delete folder apply only to custom folders", () => {
    for (const id of ["rename-folder", "delete-folder"]) {
      expect(enabled(id, ctx({ mailboxKind: "custom" }))).toBe(true);
      expect(enabled(id, ctx({ mailboxKind: "inbox" }))).toBe(false);
    }
    expect(enabled("new-folder", ctx())).toBe(true);
  });

  it("Save to vault needs a target message; the note commands are always available", () => {
    expect(enabled("save-to-vault", ctx())).toBe(true);
    expect(enabled("save-to-vault", ctx({ hasTargetMessage: false }))).toBe(false);
    expect(enabled("email-from-note", ctx({ hasAccount: false }))).toBe(true);
    expect(enabled("email-with-note-attached", ctx({ hasAccount: false }))).toBe(true);
  });
});

describe("ribbon registry — Message tab", () => {
  it("Send/Discard are disabled while sending; Save draft only in draft-backed modes", () => {
    const composing = ctx({ composerMode: "new" });
    expect(enabled("send", composing)).toBe(true);
    expect(enabled("send", ctx({ composerMode: "new", composerSending: true }))).toBe(false);
    expect(enabled("discard-draft", ctx({ composerMode: "reply", composerSending: true }))).toBe(false);
    expect(enabled("save-draft", composing)).toBe(true);
    expect(enabled("save-draft", ctx({ composerMode: "editDraft" }))).toBe(true);
    expect(enabled("save-draft", ctx({ composerMode: "reply" }))).toBe(false);
  });

  it("Attach note is only for brand-new messages (Graph takes attachments at creation)", () => {
    expect(enabled("attach-note", ctx({ composerMode: "new" }))).toBe(true);
    for (const mode of ["reply", "replyAll", "forward", "editDraft"] as const) {
      expect(enabled("attach-note", ctx({ composerMode: mode }))).toBe(false);
    }
  });

  it("run() delegates to the matching action", () => {
    const c = ctx({ composerMode: "new" });
    cmd("send").run!(c);
    cmd("attach-note").run!(c);
    expect(c.actions.send).toHaveBeenCalledOnce();
    expect(c.actions.attachNote).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/ribbon-registry.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/view/ribbon/registry.ts`:

```ts
import type { MailboxKind } from "../../providers/types";
import type { ComposerState } from "../view-model";
import { ACTION_ICON } from "../action-icons";

export type TabId = "home" | "folder" | "vault" | "message";

export interface RibbonMailboxOption { id: string; name: string }

export interface RibbonActions {
  newMessage(): void;
  reply(): void;
  replyAll(): void;
  forward(): void;
  editDraft(): void;
  archive(): void;
  deleteMessage(): void;
  move(destinationMailboxId: string): void;
  closePane(): void;
  refresh(): void;
  newFolder(): void;
  renameFolder(): void;
  deleteFolder(): void;
  saveToVault(): void;
  emailFromNote(): void;
  emailWithNoteAttached(): void;
  send(): void;
  saveDraft(): void;
  discardDraft(): void;
  attachNote(): void;
}

export interface RibbonContext {
  hasAccount: boolean;
  hasOpenThread: boolean;
  /** An expanded message exists in the open thread — the target of Reply, Archive, Delete… */
  hasTargetMessage: boolean;
  mailboxKind: MailboxKind | null;
  /** Every mailbox except the active one — the Move destinations. */
  otherMailboxes: RibbonMailboxOption[];
  readingPaneCollapsed: boolean;
  syncing: boolean;
  composerMode: ComposerState["mode"] | null;
  composerSending: boolean;
  actions: RibbonActions;
}

export interface RibbonOption { id: string; label: string; run: () => void }

export interface RibbonCommand {
  /** Also emitted as `data-action` on the rendered button. */
  id: string;
  tab: TabId;
  group: string;
  icon: string;
  label: string;
  enabled: (ctx: RibbonContext) => boolean;
  visible?: (ctx: RibbonContext) => boolean;
  run?: (ctx: RibbonContext) => void;
  options?: (ctx: RibbonContext) => RibbonOption[];
}

export const TABS: { id: TabId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "folder", label: "Folder" },
  { id: "vault", label: "Vault" },
  { id: "message", label: "Message" },
];

const kindIs = (c: RibbonContext, ...kinds: MailboxKind[]) => c.mailboxKind !== null && kinds.includes(c.mailboxKind);
const canRespond = (c: RibbonContext) => c.hasTargetMessage && !kindIs(c, "drafts", "trash");
const canArchive = (c: RibbonContext) => c.hasTargetMessage && !kindIs(c, "archive", "drafts", "trash");
const composing = (c: RibbonContext) => c.composerMode !== null;
const canAct = (c: RibbonContext) => composing(c) && !c.composerSending;

export const COMMANDS: RibbonCommand[] = [
  // Home
  { id: "new-message", tab: "home", group: "New", icon: "pencil", label: "New message",
    enabled: (c) => c.hasAccount, run: (c) => c.actions.newMessage() },
  { id: "reply", tab: "home", group: "Respond", icon: ACTION_ICON.reply, label: "Reply",
    enabled: canRespond, run: (c) => c.actions.reply() },
  { id: "reply-all", tab: "home", group: "Respond", icon: ACTION_ICON.replyAll, label: "Reply all",
    enabled: canRespond, run: (c) => c.actions.replyAll() },
  { id: "forward", tab: "home", group: "Respond", icon: ACTION_ICON.forward, label: "Forward",
    enabled: canRespond, run: (c) => c.actions.forward() },
  { id: "edit-draft", tab: "home", group: "Respond", icon: ACTION_ICON.editDraft, label: "Edit",
    visible: (c) => kindIs(c, "drafts"), enabled: (c) => c.hasTargetMessage, run: (c) => c.actions.editDraft() },
  { id: "archive", tab: "home", group: "Manage", icon: ACTION_ICON.archive, label: "Archive",
    enabled: canArchive, run: (c) => c.actions.archive() },
  { id: "delete", tab: "home", group: "Manage", icon: ACTION_ICON.delete, label: "Delete",
    enabled: (c) => c.hasTargetMessage, run: (c) => c.actions.deleteMessage() },
  { id: "move", tab: "home", group: "Manage", icon: "folder-input", label: "Move",
    enabled: (c) => c.hasOpenThread && c.otherMailboxes.length > 0,
    options: (c) => c.otherMailboxes.map((m) => ({ id: m.id, label: m.name, run: () => c.actions.move(m.id) })) },
  { id: "close-pane", tab: "home", group: "Manage", icon: ACTION_ICON.collapse, label: "Close pane",
    enabled: (c) => !c.readingPaneCollapsed, run: (c) => c.actions.closePane() },
  { id: "refresh", tab: "home", group: "Sync", icon: "refresh-cw", label: "Refresh",
    enabled: (c) => c.hasAccount && !c.syncing, run: (c) => c.actions.refresh() },

  // Folder
  { id: "new-folder", tab: "folder", group: "Folder", icon: "folder-plus", label: "New folder",
    enabled: (c) => c.hasAccount, run: (c) => c.actions.newFolder() },
  { id: "rename-folder", tab: "folder", group: "Folder", icon: "pencil", label: "Rename",
    enabled: (c) => kindIs(c, "custom"), run: (c) => c.actions.renameFolder() },
  { id: "delete-folder", tab: "folder", group: "Folder", icon: ACTION_ICON.delete, label: "Delete",
    enabled: (c) => kindIs(c, "custom"), run: (c) => c.actions.deleteFolder() },

  // Vault
  { id: "save-to-vault", tab: "vault", group: "Vault", icon: ACTION_ICON.saveToVault, label: "Save email to vault",
    enabled: (c) => c.hasTargetMessage, run: (c) => c.actions.saveToVault() },
  { id: "email-from-note", tab: "vault", group: "Vault", icon: "file-text", label: "Email from note",
    enabled: () => true, run: (c) => c.actions.emailFromNote() },
  { id: "email-with-note-attached", tab: "vault", group: "Vault", icon: "paperclip", label: "Email with note attached",
    enabled: () => true, run: (c) => c.actions.emailWithNoteAttached() },

  // Message (contextual)
  { id: "send", tab: "message", group: "Send", icon: "send", label: "Send",
    enabled: canAct, run: (c) => c.actions.send() },
  { id: "save-draft", tab: "message", group: "Send", icon: ACTION_ICON.saveToVault, label: "Save draft",
    enabled: (c) => canAct(c) && (c.composerMode === "new" || c.composerMode === "editDraft"),
    run: (c) => c.actions.saveDraft() },
  { id: "discard-draft", tab: "message", group: "Send", icon: ACTION_ICON.delete, label: "Discard",
    enabled: canAct, run: (c) => c.actions.discardDraft() },
  { id: "attach-note", tab: "message", group: "Insert", icon: "paperclip", label: "Attach note",
    enabled: (c) => canAct(c) && c.composerMode === "new", run: (c) => c.actions.attachNote() },
];

export function visibleTabs(ctx: RibbonContext): { id: TabId; label: string }[] {
  return TABS.filter((t) => t.id !== "message" || ctx.composerMode !== null);
}

export function commandsForTab(tab: TabId, ctx: RibbonContext): RibbonCommand[] {
  return COMMANDS.filter((c) => c.tab === tab && (c.visible?.(ctx) ?? true));
}

export function groupsForTab(tab: TabId, ctx: RibbonContext): string[] {
  return [...new Set(commandsForTab(tab, ctx).map((c) => c.group))];
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx tsc -noEmit -skipLibCheck && npx vitest run tests/view/ribbon-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/view/ribbon/registry.ts tests/view/ribbon-registry.test.ts
git commit -m "feat: ribbon command registry

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Ribbon components, styles and smoke tests

**Files:**
- Create: `src/view/ribbon/Ribbon.svelte`, `RibbonTab.svelte`, `RibbonGroup.svelte`, `RibbonButton.svelte`, `RibbonDropdown.svelte`
- Create: `tests/view/fixtures/RibbonHost.svelte`
- Modify: `styles.css` (append ribbon styles)
- Test: `tests/view/ribbon.smoke.test.ts`

**Interfaces:**
- Consumes: `RibbonContext`, `RibbonCommand`, `visibleTabs`, `commandsForTab`, `groupsForTab`, `TabId` (Task 4).
- Produces: `<Ribbon ctx={RibbonContext} defaultCollapsed={boolean} />` — root element `.oe-ribbon` (class `collapsed` when collapsed). Buttons: `<button class="oe-ribbon-button" data-action={id}>`; dropdown trigger has the same class + `data-action`, its menu is `.oe-ribbon-menu` with `<button class="oe-ribbon-menu-item" data-option={optionId}>`. Tabs: `<button class="oe-ribbon-tab" data-tab={id}>`, active gets class `active`. Panel: `.oe-ribbon-panel`.

- [ ] **Step 1: Create the fixture** `tests/view/fixtures/RibbonHost.svelte` (lets a test change `ctx` on a mounted ribbon):

```svelte
<script lang="ts">
  import Ribbon from "../../../src/view/ribbon/Ribbon.svelte";
  import type { RibbonContext } from "../../../src/view/ribbon/registry";

  let { initial, defaultCollapsed = false }: { initial: RibbonContext; defaultCollapsed?: boolean } = $props();

  // svelte-ignore state_referenced_locally
  let ctx = $state(initial);
  export function set(next: RibbonContext): void { ctx = next; }
</script>

<Ribbon {ctx} {defaultCollapsed} />
```

- [ ] **Step 2: Write the failing smoke test** — `tests/view/ribbon.smoke.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import Ribbon from "../../src/view/ribbon/Ribbon.svelte";
import RibbonHost from "./fixtures/RibbonHost.svelte";
import type { RibbonActions, RibbonContext } from "../../src/view/ribbon/registry";

function actions(): RibbonActions {
  const names = [
    "newMessage", "reply", "replyAll", "forward", "editDraft", "archive", "deleteMessage", "move",
    "closePane", "refresh", "newFolder", "renameFolder", "deleteFolder", "saveToVault",
    "emailFromNote", "emailWithNoteAttached", "send", "saveDraft", "discardDraft", "attachNote",
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as unknown as RibbonActions;
}

function ctx(over: Partial<RibbonContext> = {}): RibbonContext {
  return {
    hasAccount: true, hasOpenThread: true, hasTargetMessage: true, mailboxKind: "inbox",
    otherMailboxes: [{ id: "ARCH", name: "Archive" }, { id: "P", name: "Project" }],
    readingPaneCollapsed: false, syncing: false, composerMode: null, composerSending: false,
    actions: actions(), ...over,
  };
}

const q = (host: HTMLElement, sel: string) => host.querySelector<HTMLElement>(sel);

describe("Ribbon smoke", () => {
  it("renders the visible tabs, with Home active and its groups shown", () => {
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: ctx(), defaultCollapsed: false } });
    flushSync();
    expect([...host.querySelectorAll(".oe-ribbon-tab")].map((t) => t.textContent?.trim())).toEqual(["Home", "Folder", "Vault"]);
    expect(q(host, '.oe-ribbon-tab[data-tab="home"]')!.classList.contains("active")).toBe(true);
    expect(host.textContent).toContain("Respond");
    expect(q(host, '[data-action="reply"]')).not.toBeNull();
    unmount(app);
  });

  it("clicking a button runs its action", () => {
    const c = ctx();
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: c, defaultCollapsed: false } });
    flushSync();
    q(host, '[data-action="reply"]')!.click();
    expect(c.actions.reply).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("disabled buttons do not run their action", () => {
    const c = ctx({ hasTargetMessage: false });
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: c, defaultCollapsed: false } });
    flushSync();
    const btn = q(host, '[data-action="reply"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    btn.click();
    expect(c.actions.reply).not.toHaveBeenCalled();
    unmount(app);
  });

  it("switching tabs shows that tab's commands", () => {
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: ctx(), defaultCollapsed: false } });
    flushSync();
    q(host, '.oe-ribbon-tab[data-tab="folder"]')!.click();
    flushSync();
    expect(q(host, '[data-action="new-folder"]')).not.toBeNull();
    expect(q(host, '[data-action="reply"]')).toBeNull();
    unmount(app);
  });

  it("double-clicking a tab collapses the panel to just the tab strip, and again expands it", () => {
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: ctx(), defaultCollapsed: false } });
    flushSync();
    const tab = q(host, '.oe-ribbon-tab[data-tab="home"]')!;
    tab.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    flushSync();
    expect(q(host, ".oe-ribbon")!.classList.contains("collapsed")).toBe(true);
    expect(q(host, ".oe-ribbon-panel")).toBeNull();
    tab.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    flushSync();
    expect(q(host, ".oe-ribbon-panel")).not.toBeNull();
    unmount(app);
  });

  it("starts collapsed when defaultCollapsed is set", () => {
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: ctx(), defaultCollapsed: true } });
    flushSync();
    expect(q(host, ".oe-ribbon-panel")).toBeNull();
    unmount(app);
  });

  it("Move opens a menu of the other folders; choosing one calls move with its id", () => {
    const c = ctx();
    const host = document.createElement("div");
    const app = mount(Ribbon, { target: host, props: { ctx: c, defaultCollapsed: false } });
    flushSync();
    expect(q(host, ".oe-ribbon-menu")).toBeNull();
    q(host, '[data-action="move"]')!.click();
    flushSync();
    expect([...host.querySelectorAll(".oe-ribbon-menu-item")].map((i) => i.textContent?.trim())).toEqual(["Archive", "Project"]);
    q(host, '.oe-ribbon-menu-item[data-option="P"]')!.click();
    flushSync();
    expect(c.actions.move).toHaveBeenCalledWith("P");
    expect(q(host, ".oe-ribbon-menu")).toBeNull();
    unmount(app);
  });

  it("shows the Message tab and switches to it when a composer opens, then restores the previous tab on close", () => {
    const host = document.createElement("div");
    const app = mount(RibbonHost, { target: host, props: { initial: ctx() } });
    flushSync();
    q(host, '.oe-ribbon-tab[data-tab="vault"]')!.click();
    flushSync();
    expect(q(host, '.oe-ribbon-tab[data-tab="message"]')).toBeNull();

    (app as unknown as { set: (c: RibbonContext) => void }).set(ctx({ composerMode: "new" }));
    flushSync();
    expect(q(host, '.oe-ribbon-tab[data-tab="message"]')!.classList.contains("active")).toBe(true);
    expect(q(host, '[data-action="send"]')).not.toBeNull();

    (app as unknown as { set: (c: RibbonContext) => void }).set(ctx({ composerMode: null }));
    flushSync();
    expect(q(host, '.oe-ribbon-tab[data-tab="message"]')).toBeNull();
    expect(q(host, '.oe-ribbon-tab[data-tab="vault"]')!.classList.contains("active")).toBe(true);
    unmount(app);
  });

  it("falls back to Home if the active tab disappears for any other reason", () => {
    const host = document.createElement("div");
    const app = mount(RibbonHost, { target: host, props: { initial: ctx({ composerMode: "new" }) } });
    flushSync();
    // Composer already open at mount: Message tab is offered and selected.
    expect(q(host, '.oe-ribbon-tab[data-tab="message"]')!.classList.contains("active")).toBe(true);
    (app as unknown as { set: (c: RibbonContext) => void }).set(ctx({ composerMode: null }));
    flushSync();
    expect(q(host, '.oe-ribbon-tab[data-tab="home"]')!.classList.contains("active")).toBe(true);
    unmount(app);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/view/ribbon.smoke.test.ts`
Expected: FAIL (components missing).

- [ ] **Step 4: Implement components.**

`src/view/ribbon/RibbonTab.svelte`:
```svelte
<script lang="ts">
  let { id, label, active, onselect, ondoubleclick }: {
    id: string; label: string; active: boolean; onselect: () => void; ondoubleclick: () => void;
  } = $props();
</script>

<button type="button" role="tab" aria-selected={active} class="oe-ribbon-tab" class:active data-tab={id}
        onclick={onselect} ondblclick={ondoubleclick}>{label}</button>
```

`src/view/ribbon/RibbonButton.svelte`:
```svelte
<script lang="ts">
  import { icon } from "../icon-action";
  import type { RibbonCommand, RibbonContext } from "./registry";

  let { command, ctx }: { command: RibbonCommand; ctx: RibbonContext } = $props();
  const enabled = $derived(command.enabled(ctx));
</script>

<button type="button" class="oe-ribbon-button" data-action={command.id}
        title={command.label} aria-label={command.label} disabled={!enabled}
        onclick={() => command.run?.(ctx)}>
  <span class="oe-ribbon-icon" use:icon={command.icon}></span>
  <span class="oe-ribbon-label">{command.label}</span>
</button>
```

`src/view/ribbon/RibbonDropdown.svelte` (closes on outside click and Escape):
```svelte
<script lang="ts">
  import { icon } from "../icon-action";
  import type { RibbonCommand, RibbonContext } from "./registry";

  let { command, ctx }: { command: RibbonCommand; ctx: RibbonContext } = $props();
  const enabled = $derived(command.enabled(ctx));
  const options = $derived(command.options?.(ctx) ?? []);
  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (root && !root.contains(e.target as Node)) open = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") open = false; };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  });
  // A dropdown whose command becomes disabled must not stay open.
  $effect(() => { if (!enabled) open = false; });
</script>

<div class="oe-ribbon-dropdown" bind:this={root}>
  <button type="button" class="oe-ribbon-button" data-action={command.id}
          title={command.label} aria-label={command.label} aria-haspopup="menu" aria-expanded={open}
          disabled={!enabled} onclick={() => (open = !open)}>
    <span class="oe-ribbon-icon" use:icon={command.icon}></span>
    <span class="oe-ribbon-label">{command.label} ▾</span>
  </button>
  {#if open}
    <div class="oe-ribbon-menu" role="menu">
      {#each options as option (option.id)}
        <button type="button" role="menuitem" class="oe-ribbon-menu-item" data-option={option.id}
                onclick={() => { open = false; option.run(); }}>{option.label}</button>
      {/each}
    </div>
  {/if}
</div>
```

`src/view/ribbon/RibbonGroup.svelte`:
```svelte
<script lang="ts">
  import type { RibbonCommand, RibbonContext } from "./registry";
  import RibbonButton from "./RibbonButton.svelte";
  import RibbonDropdown from "./RibbonDropdown.svelte";

  let { label, commands, ctx }: { label: string; commands: RibbonCommand[]; ctx: RibbonContext } = $props();
</script>

<div class="oe-ribbon-group">
  <div class="oe-ribbon-group-buttons">
    {#each commands as command (command.id)}
      {#if command.options}
        <RibbonDropdown {command} {ctx} />
      {:else}
        <RibbonButton {command} {ctx} />
      {/if}
    {/each}
  </div>
  <div class="oe-ribbon-group-label">{label}</div>
</div>
```

`src/view/ribbon/Ribbon.svelte`:
```svelte
<script lang="ts">
  import { untrack } from "svelte";
  import { commandsForTab, groupsForTab, visibleTabs, type RibbonContext, type TabId } from "./registry";
  import RibbonTab from "./RibbonTab.svelte";
  import RibbonGroup from "./RibbonGroup.svelte";

  let { ctx, defaultCollapsed }: { ctx: RibbonContext; defaultCollapsed: boolean } = $props();

  let activeTab = $state<TabId>("home");
  // svelte-ignore state_referenced_locally
  let collapsed = $state(defaultCollapsed);
  const tabs = $derived(visibleTabs(ctx));
  const composing = $derived(ctx.composerMode !== null);

  // A composer opening jumps to the contextual Message tab (remembering where
  // the user was); closing restores it. Anything else that removes the active
  // tab falls back to Home.
  let tabBeforeCompose: TabId | null = null;
  let wasComposing = false;
  $effect(() => {
    const now = composing;
    untrack(() => {
      if (now && !wasComposing) {
        tabBeforeCompose = activeTab === "message" ? tabBeforeCompose : activeTab;
        activeTab = "message";
      } else if (!now && wasComposing) {
        activeTab = tabBeforeCompose ?? "home";
        tabBeforeCompose = null;
      }
      wasComposing = now;
    });
  });
  $effect(() => {
    if (!tabs.some((t) => t.id === activeTab)) activeTab = "home";
  });

  const groups = $derived(groupsForTab(activeTab, ctx));
</script>

<div class="oe-ribbon" class:collapsed>
  <div class="oe-ribbon-tab-strip" role="tablist">
    {#each tabs as tab (tab.id)}
      <RibbonTab id={tab.id} label={tab.label} active={tab.id === activeTab}
                 onselect={() => (activeTab = tab.id)} ondoubleclick={() => (collapsed = !collapsed)} />
    {/each}
  </div>
  {#if !collapsed}
    <div class="oe-ribbon-panel">
      {#each groups as group (group)}
        <RibbonGroup label={group} commands={commandsForTab(activeTab, ctx).filter((c) => c.group === group)} {ctx} />
      {/each}
    </div>
  {/if}
</div>
```

Append to `styles.css`:
```css
/* --- Ribbon --- */
.oe-shell { display: flex; flex-direction: column; height: 100%; }
.oe-ribbon { flex: 0 0 auto; border-bottom: 1px solid var(--background-modifier-border); background-color: var(--background-secondary); font-size: var(--font-ui-small); user-select: none; }
.oe-ribbon-tab-strip { display: flex; gap: 2px; padding: 2px 8px 0; }
.oe-ribbon-tab { background: transparent; border: none; border-radius: 4px 4px 0 0; padding: 4px 12px; height: auto; color: var(--text-muted); cursor: pointer; box-shadow: none; }
.oe-ribbon-tab:hover { background-color: var(--background-modifier-hover); color: var(--text-normal); }
.oe-ribbon-tab.active { background-color: var(--background-primary); color: var(--text-normal); font-weight: var(--font-weight-bold, 600); }
.oe-ribbon-panel { display: flex; gap: 8px; padding: 6px 12px; background-color: var(--background-primary); overflow-x: auto; }
.oe-ribbon-group { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 0 10px; border-right: 1px solid var(--background-modifier-border); flex: 0 0 auto; }
.oe-ribbon-group:last-child { border-right: none; }
.oe-ribbon-group-buttons { display: flex; gap: 4px; }
.oe-ribbon-group-label { font-size: var(--font-ui-smaller); color: var(--text-faint); }
.oe-ribbon-button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; height: auto; min-width: 52px; padding: 4px 8px; box-sizing: border-box; background: transparent; border: 1px solid transparent; border-radius: 4px; color: var(--text-normal); cursor: pointer; box-shadow: none; font: inherit; }
.oe-ribbon-button:hover:not(:disabled) { background-color: var(--background-modifier-hover); }
.oe-ribbon-button:disabled { opacity: 0.4; cursor: default; }
.oe-ribbon-icon { display: inline-flex; width: 20px; height: 20px; }
.oe-ribbon-icon svg { width: 20px; height: 20px; }
.oe-ribbon-label { font-size: var(--font-ui-smaller); white-space: nowrap; }
.oe-ribbon-dropdown { position: relative; }
.oe-ribbon-menu { position: absolute; z-index: 20; top: 100%; left: 0; min-width: 160px; max-height: 260px; overflow-y: auto; padding: 4px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; box-shadow: var(--shadow-s); display: flex; flex-direction: column; }
.oe-ribbon-menu-item { height: auto; text-align: left; background: transparent; border: none; box-shadow: none; padding: 4px 8px; border-radius: 4px; color: var(--text-normal); cursor: pointer; font: inherit; }
.oe-ribbon-menu-item:hover { background-color: var(--background-modifier-hover); }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx tsc -noEmit -skipLibCheck && npx vitest run tests/view/ribbon.smoke.test.ts tests/view/ribbon-registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/view/ribbon tests/view/ribbon.smoke.test.ts tests/view/fixtures/RibbonHost.svelte styles.css
git commit -m "feat: ribbon components (tabs, groups, buttons, dropdown, contextual Message tab)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: ReadingPane — lift expansion state, drop the action row

**Files:**
- Modify: `src/view/components/ReadingPane.svelte`
- Modify: `tests/view/fixtures/ReadingPaneHost.svelte`
- Modify: `tests/view/reading-pane.smoke.test.ts`

**Interfaces:**
- New `ReadingPane` props: `targetMessageId?: string | null` (the expanded message; `undefined` ⇒ fall back to the last message so simple direct mounts still expand it) and `onToggleExpand?: (id: string) => void`.
- Removed props: `onCollapse`, `isDraftsMailbox`, `isArchiveMailbox`, `isTrashMailbox`, `onOpenReply`, `onOpenForward`, `onEditDraft`, `onArchiveMessage`, `onDeleteMessage`, `onSaveToVault`. The `.oe-reading-actions` row is deleted. `onClose` (subject-header ✕) stays.

- [ ] **Step 1: Implement in `src/view/components/ReadingPane.svelte`.**

Replace the imports/props/state block (lines 1–51) with:

```svelte
<script lang="ts">
  import type { AttachmentMeta } from "../../providers/types";
  import type { ComposerFieldProps } from "../composer-props";
  import type { ViewState } from "../view-model";
  import Composer from "./Composer.svelte";
  import MessageBlock from "./MessageBlock.svelte";

  let { openMessages, autoLoadImages, renderDeps, onClose, onDownload, targetMessageId, onToggleExpand, activeComposerMessageId, composerMode, composerProps }: {
    openMessages: ViewState["openMessages"];
    /** `prefs.autoLoadImages` — when true, remote content renders immediately. */
    autoLoadImages: boolean;
    renderDeps: { getInlineAttachment: (cid: string) => Promise<Blob | undefined>; openExternal: (url: string) => void };
    onClose: () => void;
    onDownload: (messageId: string, att: AttachmentMeta) => void;
    /** The expanded message (owned by App so the ribbon can act on it).
     *  `undefined` means "not controlled": expand the last message. */
    targetMessageId?: string | null;
    onToggleExpand?: (messageId: string) => void;
    activeComposerMessageId?: string | null;
    composerMode?: "reply" | "replyAll" | "forward" | "new" | "editDraft" | null;
    composerProps?: ComposerFieldProps | null;
  } = $props();

  const lastId = $derived(openMessages.at(-1)?.summary.id ?? null);
  const isExpanded = (id: string) => (targetMessageId === undefined ? lastId : targetMessageId) === id;
</script>
```

Delete the whole `{#if expandedMessage} <div class="oe-reading-actions">…</div> {/if}` block. In the `{#each}` change `onToggle` to `onToggle={() => onToggleExpand?.(m.summary.id)}`. Composer render lines: `{#if composerMode === "new" || composerMode === "editDraft"}{#if composerProps}<Composer mode={composerMode} {...composerProps} />{/if}` are unchanged. Remove now-unused `ACTION_ICON` / `icon` imports (already removed above).

- [ ] **Step 2: Update the fixture** `tests/view/fixtures/ReadingPaneHost.svelte` so toggling still works (it owns the expansion state the way App will):

```svelte
<script lang="ts">
  import type { AttachmentMeta } from "../../../src/providers/types";
  import type { ViewState } from "../../../src/view/view-model";
  import ReadingPane from "../../../src/view/components/ReadingPane.svelte";

  let { initial, autoLoadImages = false, renderDeps, onClose, onDownload }: {
    initial: ViewState["openMessages"];
    autoLoadImages?: boolean;
    renderDeps: { getInlineAttachment: (cid: string) => Promise<Blob | undefined>; openExternal: (url: string) => void };
    onClose: () => void;
    onDownload: (messageId: string, att: AttachmentMeta) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let messages = $state(initial);
  let expandedId = $state<string | null>(null);
  const target = $derived(expandedId ?? messages.at(-1)?.summary.id ?? null);
  // Mirrors App.svelte: expansion resets only when the thread (its first
  // message id) changes, not on per-message body loads within one thread.
  let threadKey: string | null = null;
  $effect(() => {
    const firstId = messages[0]?.summary.id ?? null;
    if (firstId !== threadKey) {
      threadKey = firstId;
      expandedId = null;
    }
  });
  export function set(m: ViewState["openMessages"]): void { messages = m; }
</script>

<ReadingPane
  openMessages={messages} {autoLoadImages} {renderDeps} {onClose} {onDownload}
  targetMessageId={target}
  onToggleExpand={(id) => (expandedId = expandedId === id ? null : id)}
/>
```

- [ ] **Step 3: Update `tests/view/reading-pane.smoke.test.ts`.**

Delete these tests (they exercise the removed action row; their rules are now covered by `ribbon-registry.test.ts` and the App-level ribbon tests):
- In `describe("ReadingPane — reply/forward/edit actions")`: "shows Reply/Reply all/Forward buttons on a message when not in the Drafts mailbox", "shows an Edit button instead, in the Drafts mailbox", "clicking Reply calls onOpenReply(m1, 'reply')".
- The entire `describe("ReadingPane — archive/delete actions")` block (all of: "shows Save to vault in a normal mailbox…", "still shows Save to vault in Drafts and Trash mailboxes", "clicking the floating close button calls onCollapse", "shows Archive and Delete on a message in a normal mailbox", "hides Reply/Reply-all/Forward and Archive in the Trash mailbox…", "hides Archive (but not Delete) in the Archive mailbox…", "in Drafts, shows Edit and Delete but not Archive", "clicking Archive calls onArchiveMessage(m1)", "clicking Delete calls onDeleteMessage(m1)").

Keep "renders the Composer inline under the message being replied to" and "renders a top-level Composer for mode=new/editDraft instead of the empty state", removing the deleted props (`isDraftsMailbox`, `onOpenReply`, `onOpenForward`, `onEditDraft`) from their mount calls. Keep everything in `describe("ReadingPane smoke")` unchanged — the tests that toggle or reset expansion ("resets manual expansion when the open thread changes", "does not toggle expansion when the header click ends a text selection", "toggles expansion on Enter or Space…") already go through `ReadingPaneHost`, which now supplies `targetMessageId`/`onToggleExpand` itself.

- [ ] **Step 4: Run**

Run: `npx vitest run tests/view/reading-pane.smoke.test.ts`
Expected: PASS. (`app.smoke.test.ts` is intentionally broken until Task 7 — do not run the full suite yet.)

- [ ] **Step 5: Commit**

```bash
git add src/view/components/ReadingPane.svelte tests/view/fixtures/ReadingPaneHost.svelte tests/view/reading-pane.smoke.test.ts
git commit -m "refactor: lift reading-pane expansion state up and remove the in-pane action row

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: App integration — layout, context, removals, composer row

**Files:**
- Modify: `src/view/App.svelte`
- Modify: `src/view/components/Composer.svelte`
- Modify: `src/view/composer-props.ts`
- Modify: `styles.css` (layout + removed-rule cleanup)
- Modify: `tests/view/composer.smoke.test.ts`, `tests/view/fixtures/ComposerHost.svelte`, `tests/view/reading-pane.smoke.test.ts` (composerProps fixture), `tests/view/app.smoke.test.ts`

**Interfaces:**
- `App` gains props `noteCommands: NoteCommands` (from `mail-view.ts`; import type only — `NoteCommands` is a plain interface so the type import does not pull `obsidian` into the Svelte file at runtime).
- `ComposerFieldProps` loses `onSend`, `onSaveDraft`, `onDiscard`. `Composer.svelte` loses those props, the `.oe-composer-actions` row, and the `showSave`/`sendLabel` derivations.
- `ViewState` fields `ribbonEnabled` / `ribbonCollapsedByDefault` (Task 2) drive the ribbon.

- [ ] **Step 1: Composer — remove the button row.**

`src/view/composer-props.ts`: delete `onSend`, `onSaveDraft`, `onDiscard`.
`src/view/components/Composer.svelte`: remove `onSend, onSaveDraft, onDiscard` from the destructured props and their type entries; delete `showSave` and `sendLabel` `$derived`s; delete the `<div class="oe-composer-actions">…</div>` block. `mode` is still used by `showRecipients`/`showCcBccSubject`. `sending` remains a prop (still disables nothing in the component; keep it because `composerFieldProps` supplies it — if `svelte-check` reports it unused, drop it from both).

Update tests: in `tests/view/composer.smoke.test.ts` delete the `.oe-composer-save` presence/absence assertions (lines asserting "Save draft button"), the "Send/Save draft/Discard buttons call their callbacks" test, and the `.oe-composer-send` disabled assertion in "shows the error message when present…" (keep the `boom` text assertion); drop `onSend/onSaveDraft/onDiscard` from `baseProps()` and from `ComposerHost.svelte` and the two `mount(ComposerHost…)` prop objects. In `reading-pane.smoke.test.ts` drop those three from the `composerProps` const.

- [ ] **Step 2: App — layout, expansion state, ribbon context.**

In `src/view/App.svelte` script:

Imports — add:
```ts
  import Ribbon from "./ribbon/Ribbon.svelte";
  import type { RibbonContext } from "./ribbon/registry";
  import type { NoteCommands } from "./mail-view";
```
Props — add `noteCommands` to the destructure and type: `noteCommands: NoteCommands;`.

Add the lifted expansion state after `isTrashMailbox` (the derivations of mailbox kind stay; they now feed the ribbon):
```ts
  const activeMailbox = $derived(state.mailboxes.find((m) => m.id === state.activeMailboxId) ?? null);

  // Which message in the open thread is expanded — and so the target of the
  // ribbon's Reply/Archive/Delete/… . Lifted out of ReadingPane so both share it.
  let expandedId = $state<string | null>(null);
  const targetMessageId = $derived(expandedId ?? state.openMessages.at(-1)?.summary.id ?? null);
  let threadKey: string | null = null;
  $effect(() => {
    const firstId = state.openMessages[0]?.summary.id ?? null;
    if (firstId !== threadKey) {
      threadKey = firstId;
      expandedId = null;
    }
  });
  const toggleExpand = (id: string): void => { expandedId = expandedId === id ? null : id; };
```

Remove `onSend/onSaveDraft/onDiscard` from `composerFieldProps`.

Add the ribbon context (place after `moveThread`, so all guards are defined):
```ts
  const ribbonCtx = $derived<RibbonContext>({
    hasAccount: state.activeAccountId !== null,
    hasOpenThread: state.openThreadId !== null,
    hasTargetMessage: targetMessageId !== null,
    mailboxKind: activeMailbox?.kind ?? null,
    otherMailboxes: state.mailboxes
      .filter((m) => m.id !== state.activeMailboxId)
      .map((m) => ({ id: m.id, name: m.name })),
    readingPaneCollapsed,
    syncing: activeSyncing,
    composerMode: state.composer?.mode ?? null,
    composerSending: state.composer?.sending ?? false,
    actions: {
      newMessage: () => requestSwitch(() => vm.openNewMessage()),
      reply: () => targetMessageId && requestSwitch(() => vm.openReply(targetMessageId, "reply")),
      replyAll: () => targetMessageId && requestSwitch(() => vm.openReply(targetMessageId, "replyAll")),
      forward: () => targetMessageId && requestSwitch(() => vm.openForward(targetMessageId)),
      editDraft: () => targetMessageId && requestSwitch(() => vm.openDraftForEdit(targetMessageId)),
      archive: () => {
        const id = targetMessageId;
        if (!id) return;
        requestRowAction(() => { const closes = closesOpenMessage(id); vm.archiveMessage(id); if (closes) setReadingPaneCollapsed(true); });
      },
      deleteMessage: () => {
        const id = targetMessageId;
        if (!id) return;
        requestRowAction(() => requestDelete("message", () => { const closes = closesOpenMessage(id); vm.deleteMessage(id); if (closes) setReadingPaneCollapsed(true); }));
      },
      move: (destinationId) => { if (state.openThreadId) moveThread(state.openThreadId, destinationId); },
      closePane: () => requestSwitch(() => { vm.closeThread(); setReadingPaneCollapsed(true); }),
      refresh: () => { void vm.refresh(); },
      newFolder: () => vm.requestCreateMailbox(),
      renameFolder: () => { if (state.activeMailboxId) vm.requestRenameMailbox(state.activeMailboxId); },
      deleteFolder: () => {
        const id = state.activeMailboxId;
        if (!id) return;
        requestRowAction(() => requestDeleteMailbox(() => { void vm.deleteMailbox(id); }));
      },
      saveToVault: () => { if (targetMessageId) void vm.saveMessageToVault(targetMessageId); },
      emailFromNote: () => requestSwitch(() => noteCommands.composeFromNote()),
      emailWithNoteAttached: () => requestSwitch(() => noteCommands.composeWithNoteAttached()),
      send: () => { void vm.send(); },
      saveDraft: () => { void vm.saveDraft(); },
      discardDraft: () => { void vm.discardDraft(); },
      attachNote: () => { void vm.requestAttachNote(); },
    },
  });
```

Template changes (replace the root `<div class="obsidian-email-view oe-grid" …>`):
```svelte
<div class="obsidian-email-view oe-shell">
  {#if state.ribbonEnabled}
    <Ribbon ctx={ribbonCtx} defaultCollapsed={state.ribbonCollapsedByDefault} />
  {/if}
  <div class="oe-grid" style={gridStyle}>
  … existing grid children …
  </div>
</div>
```
Remove the two sidebar buttons: `<button class="oe-new-message-full">` and `<button class="oe-new-folder">` (and the now-unused `icon` import if nothing else in App uses it). Update `<ReadingPane …>`: delete props `onCollapse`, `isDraftsMailbox`, `isArchiveMailbox`, `isTrashMailbox`, `onOpenReply`, `onOpenForward`, `onEditDraft`, `onArchiveMessage`, `onDeleteMessage`, `onSaveToVault`; add `{targetMessageId}` and `onToggleExpand={toggleExpand}`. Keep `onClose`, `onDownload`, the composer props, `activeComposerMessageId`, `composerMode`.

Keep `isDraftsMailbox` / `isArchiveMailbox` / `isTrashMailbox` derivations — `MessageList` still uses them for row buttons.

- [ ] **Step 3: CSS.** In `styles.css`:
- Change `.obsidian-email-view { height: 100%; }` to keep as is (it is also `.oe-shell`, which sets `height: 100%` too).
- Change `.oe-grid` rule: replace `height: 100%;` with `flex: 1 1 auto; min-height: 0;` (keep `position: relative; display: grid; overflow: hidden;`).
- Delete the now-dead rules: `.oe-new-message-full` (+ `:hover`, icon rules), `.oe-new-folder` (+ `:hover`, icon rules), `.oe-reading-actions` selectors (keep `.oe-thread-actions`), `.oe-collapse-reading` rules, `.oe-composer-actions` rules and `.oe-composer-send`. Grep first: `grep -n "oe-new-message-full\|oe-new-folder\|oe-reading-actions\|oe-collapse-reading\|oe-composer-actions\|oe-composer-send" styles.css` and remove only rules that no longer match any element; where a rule shares a selector list with `.oe-thread-actions` (lines ~153–155) trim just the `.oe-reading-actions` selectors.

- [ ] **Step 4: Update `tests/view/app.smoke.test.ts`.**

- `fakeVm` default state: add `ribbonEnabled: true, ribbonCollapsedByDefault: false,`; add stub methods `requestRenameMailbox: vi.fn(), requestAttachNote: vi.fn(), saveMessageToVault: vi.fn(), openDraftForEdit` (already present) to the returned object.
- Every `mount(App, { props: { vm: …, onAddAccount: () => {} } })` needs `noteCommands: { composeFromNote: vi.fn(), composeWithNoteAttached: vi.fn() }` — add a shared helper `const appProps = (vm: ViewModel, over: object = {}) => ({ vm, onAddAccount: () => {}, onThreadContextMenu: () => {}, onMailboxContextMenu: () => {}, noteCommands: { composeFromNote: vi.fn(), composeWithNoteAttached: vi.fn() }, ...over });` and use it (search for `onAddAccount: () => {}` — existing call sites already pass extra props inline, keep those and add `noteCommands`).
- Sidebar button tests: `.oe-new-message-full` clicks (≈8 sites) become `[data-action="new-message"]` inside the ribbon: `host.querySelector<HTMLElement>('.oe-ribbon [data-action="new-message"]')!.click()`. The `.oe-new-folder` click test becomes `.oe-ribbon` → click tab `folder` first (`.oe-ribbon-tab[data-tab="folder"]`, then `flushSync()`), then `[data-action="new-folder"]`.
- `[data-action="collapse"]` (line ~143) becomes `.oe-ribbon [data-action="close-pane"]`.
- Row-vs-ribbon collisions: every remaining `[data-action="archive"|"delete"]` selector must be scoped. Row-level tests (the message list's per-row buttons) → `.oe-thread-actions [data-action="…"]`; tests that were clicking the reading pane's row (line ~595 used `.oe-reading-actions [data-action="delete"]`) → `.oe-ribbon [data-action="delete"]`. Determine which by which component the test's intent exercises (test names mention "message" for the reading pane and "thread" for rows).
- Tests asserting button *absence* by mailbox kind (`edit-draft`/`reply`/`archive` `toBeNull`) → assert on the ribbon: absent for `edit-draft` outside Drafts, `disabled` (not absent) for reply/archive where the registry disables them.
- Add these new App-level tests:

```ts
describe("App.svelte — ribbon", () => {
  it("renders the ribbon above the grid when enabled", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(fakeVm()) });
    flushSync();
    expect(host.querySelector(".oe-shell > .oe-ribbon")).not.toBeNull();
    expect(host.querySelector(".oe-shell > .oe-grid")).not.toBeNull();
    unmount(app);
  });

  it("renders no ribbon when the pref is off", () => {
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(fakeVm({ ribbonEnabled: false })) });
    flushSync();
    expect(host.querySelector(".oe-ribbon")).toBeNull();
    unmount(app);
  });

  it("Reply targets the expanded message and opens a reply composer", () => {
    const vm = fakeVm({ openThreadId: "t1", openMessages: [{ summary: threadView("t1", "m1", "Hello").messages[0], body: undefined }] });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    host.querySelector<HTMLElement>('.oe-ribbon [data-action="reply"]')!.click();
    expect(vm.openReply).toHaveBeenCalledWith("m1", "reply");
    unmount(app);
  });

  it("the ribbon's target message follows the expanded message and resets when the thread changes", () => {
    const messageFor = (threadId: string, id: string) => ({ summary: threadView(threadId, id, `S ${id}`).messages[0], body: undefined });
    const vm = fakeVm({ openThreadId: "t1", openMessages: [messageFor("t1", "m1"), messageFor("t1", "m2")] });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    const reply = () => host.querySelector<HTMLElement>('.oe-ribbon [data-action="reply"]')!.click();

    reply();
    expect(vm.openReply).toHaveBeenLastCalledWith("m2", "reply"); // defaults to the last message

    host.querySelectorAll<HTMLElement>(".oe-message-head")[0].click(); // expand m1
    flushSync();
    reply();
    expect(vm.openReply).toHaveBeenLastCalledWith("m1", "reply");

    setStateOf(vm)({ openThreadId: "t2", openMessages: [messageFor("t2", "n1"), messageFor("t2", "n2")] });
    flushSync();
    reply();
    expect(vm.openReply).toHaveBeenLastCalledWith("n2", "reply"); // manual expansion reset
    unmount(app);
  });

  it("Email from note goes through the unsaved-composer guard", () => {
    const vm = fakeVm();
    const noteCommands = { composeFromNote: vi.fn(), composeWithNoteAttached: vi.fn() };
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm, { noteCommands }) });
    flushSync();
    host.querySelector<HTMLElement>('.oe-ribbon-tab[data-tab="vault"]')!.click();
    flushSync();
    host.querySelector<HTMLElement>('[data-action="email-from-note"]')!.click();
    expect(noteCommands.composeFromNote).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("Send/Save draft/Discard live on the contextual Message tab and call the view model", () => {
    const vm = fakeVm();
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    setStateOf(vm)({ composer: { mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "", attachments: [], sending: false, error: null, savedSnapshot: null } });
    flushSync();
    expect(host.querySelector('.oe-ribbon-tab[data-tab="message"]')!.classList.contains("active")).toBe(true);
    host.querySelector<HTMLElement>('[data-action="send"]')!.click();
    host.querySelector<HTMLElement>('[data-action="save-draft"]')!.click();
    host.querySelector<HTMLElement>('[data-action="discard-draft"]')!.click();
    expect(vm.send).toHaveBeenCalledOnce();
    expect(vm.saveDraft).toHaveBeenCalledOnce();
    expect(vm.discardDraft).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("Rename/Delete folder are enabled for a custom active folder and route to the view model", () => {
    const vm = fakeVm({
      mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }, { id: "P", name: "Project", kind: "custom" }],
      activeMailboxId: "P",
    });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: appProps(vm) });
    flushSync();
    host.querySelector<HTMLElement>('.oe-ribbon-tab[data-tab="folder"]')!.click();
    flushSync();
    host.querySelector<HTMLElement>('[data-action="rename-folder"]')!.click();
    expect(vm.requestRenameMailbox).toHaveBeenCalledWith("P");
    host.querySelector<HTMLElement>('[data-action="delete-folder"]')!.click();
    flushSync();
    expect(host.querySelector(".oe-delete-confirm")).not.toBeNull();
    unmount(app);
  });
});
```
(`threadView`, `fakeVm`, `setStateOf` already exist in this file; add `appProps` near `fakeVm`.)

- [ ] **Step 5: Run everything**

Run: `npx tsc -noEmit -skipLibCheck && npm test`
Expected: PASS. Fix remaining selector collisions by scoping as described in Step 4 — each failure names the offending selector.

- [ ] **Step 6: Commit**

```bash
git add -A src styles.css tests
git commit -m "feat: mount the ribbon in the mail view and retire the scattered action buttons

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Verify in the dev vault

**Files:** none (verification only).

- [ ] **Step 1: Full verification**

Run: `npx tsc -noEmit -skipLibCheck && npm test && npm run build`
Expected: all PASS, build clean.

- [ ] **Step 2: Deploy**

Run: `cp main.js manifest.json styles.css /Users/mfilbin/obsidian-dev-vault/.obsidian/plugins/obsidian-email/`

- [ ] **Step 3: Manual pass (reload the plugin in Obsidian) and check each:**
1. Ribbon renders full-width above the three columns; layout below it is unchanged and fills the height.
2. Home: New message opens a composer and the ribbon jumps to the Message tab; closing the composer returns to the previous tab.
3. Select a thread: Reply / Reply all / Forward act on the *expanded* message (expand an earlier message in a multi-message thread and confirm the target changes).
4. Archive / Delete / Move (dropdown lists other folders, Escape and outside-click close it) / Close pane.
5. In Drafts: Edit appears and works; Reply trio is disabled. In Trash: Delete asks for confirmation.
6. Folder tab: New folder; Rename and Delete enabled only on custom folders; Delete still confirms; a built-in folder (Inbox) disables both.
7. Vault tab: Save email to vault; Email from note; Email with note attached (both go through the unsaved-composer prompt if a composer has content).
8. Message tab: Send, Save draft, Discard; Attach note enabled only for a *new* message and adds a chip; disabled for reply/forward/edit-draft.
9. Double-click a tab collapses/expands; Settings → "Show ribbon" off (then refresh) removes it; "Collapse by default" starts collapsed.
10. Narrow the pane: the ribbon panel scrolls horizontally instead of wrapping. Check light and dark themes.
11. Right-click menus (message Move, folder Rename/Delete) and search/refresh in the list header still work.

- [ ] **Step 4:** Report results to the user; if anything fails, fix in a follow-up commit before opening the PR (version bump + PR are separate, user-initiated steps).
