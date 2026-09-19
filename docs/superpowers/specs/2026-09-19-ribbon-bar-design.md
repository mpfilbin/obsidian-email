# Ribbon Bar — Design

## Goal

Add an Office/Outlook-style tabbed ribbon to the mail view. It becomes the
single home for mail actions (compose, reply, archive, delete, move, folder
management, vault integration), replacing the buttons currently scattered
across the sidebar, reading pane and composer. The pattern is borrowed from the
sibling `ribbon-bar` plugin: a declarative command registry rendered by generic
tab/group/button components.

## Decisions (agreed with the user)

- Existing actions **move into** the ribbon (not duplicated).
- Tabs: **Home / Folder / Vault**, plus a **contextual Message tab** while a
  composer is open.
- Right-click context menus (message Move; folder Rename/Delete) stay.
- Search moves into the ribbon too (Home → Search): a toggle that shows or hides
  the search field above the message list. The field takes focus, Enter submits
  (there is no Search button), and its ✕ / Escape / clicking Search again
  dismisses it and clears any active search so the list returns to the current
  folder. The old "Search: … ✕" pill is removed.
- The search bar's own Refresh button is removed; Refresh lives only on the
  ribbon (Home → Sync).

## Architecture

The ribbon lives inside the mail view's own Svelte tree, as a full-width row
above the three-column grid. (`ribbon-bar` needs an injection point because it
decorates Obsidian's markdown views; this plugin owns its view, so it does not.)
The view root becomes a flex column: ribbon, then the existing grid.

New folder `src/view/ribbon/`:

- `registry.ts` — pure data + predicates, no Svelte/Obsidian imports.
  ```ts
  type TabId = "home" | "folder" | "vault" | "message";
  interface RibbonCommand {
    id: string;            // also emitted as data-action on the button
    tab: TabId;
    group: string;
    icon: string;          // Lucide id, rendered through the existing use:icon action
    label: string;
    enabled: (ctx: RibbonContext) => boolean;
    pressed?: (ctx: RibbonContext) => boolean;  // toggle-style commands (Search)
    run?: (ctx: RibbonContext) => void;
    options?: (ctx: RibbonContext) => RibbonOption[];  // dropdown commands (Move)
  }
  ```
  `TABS`, `COMMANDS`, `visibleTabs(ctx)` (hides `message` unless a composer is
  open) and `commandsForTab/groupsForTab` helpers.
- `Ribbon.svelte`, `RibbonTab.svelte`, `RibbonGroup.svelte`,
  `RibbonButton.svelte`, `RibbonDropdown.svelte` — generic renderers ported
  from `ribbon-bar`, adapted from "editor" to "context".

Host-layer separation is unchanged: nothing under `src/view/ribbon/` imports
`obsidian`; icons go through `icon-action.ts`.

### RibbonContext

`App.svelte` derives one `RibbonContext` from view state and its existing
guarded handlers, and passes it to `<Ribbon>`.

Facts: `openThreadId`, `targetMessageId` (the expanded message), active mailbox
`kind`/`id`, `otherMailboxes`, `composer` mode + `sending`, `isDraftsMailbox`,
`isTrashMailbox`, `isArchiveMailbox`, `syncing`, `searchOpen`.

Actions (thin wrappers over existing App.svelte logic — `requestSwitch`,
`requestRowAction`, `requestDelete`, `requestDeleteMailbox`, `moveThread`,
unsaved-composer prompt): `newMessage`, `reply`, `replyAll`, `forward`,
`archive`, `delete`, `move(mailboxId)`, `refresh`, `toggleSearch`, `newFolder`, `renameFolder`,
`deleteFolder`, `saveToVault`, `emailFromNote`, `emailWithNoteAttached`, `send`,
`saveDraft`, `discardDraft`, `attachNote`.

Guard logic (unsaved-composer prompt, delete confirmation, collapsing the
reading pane) stays in `App.svelte`/`ViewModel`. The registry only decides
*whether* a button is enabled and *which* action it calls.

### State lifted from ReadingPane

`ReadingPane` currently owns `expandedId` (which message in a thread is
expanded), and its action row acts on that message. The ribbon needs the same
target, so `expandedId` moves up to `App.svelte` and is passed down as a prop
plus an `onExpand` callback. `ReadingPane` keeps rendering; it no longer owns
the state or the action row.

## Tabs and commands

| Tab | Group | Commands |
|---|---|---|
| Home | New | New message |
| Home | Respond | Reply, Reply all, Forward |
| Home | Manage | Archive, Delete, Move (dropdown of other folders) |
| Home | Sync | Refresh |
| Home | Search | Search (toggle: shows/hides the search field) |
| Folder | Folder | New folder, Rename, Delete |
| Vault | Vault | Save email to vault, Email from note, Email with note attached |
| Message (contextual) | Send | Send, Save draft, Discard |
| Message (contextual) | Insert | Attach note |

Enabled rules (examples): Reply/Reply all/Forward need a target message and are
disabled in Drafts/Trash (today's reading-pane row omits them there); Archive is disabled in Archive/Drafts/Trash; Rename/Delete folder need the
active mailbox to be `kind === "custom"`; Send/Save/Discard disable while
`composer.sending`; Save draft only for `new`/`editDraft` modes. Drafts keep
their "Edit" affordance (Home → Respond group shows **Edit** in place of the
reply trio when the target is in Drafts).

### Contextual Message tab

Appears when `composer` is non-null. The ribbon selects it automatically when a
composer opens and returns to the previously selected tab when it closes. Send,
Save draft, Discard call the existing `vm.send/saveDraft/discardDraft`.

**Attach note** adds an attachment to the open composer:
- New `ViewModel.addComposerAttachment(att)`.
- Host capability `pickNoteAttachment(): Promise<OutgoingAttachment | undefined>`
  in `main.ts` (reuses `NotePickerModal`, `readBinary`, `arrayBufferToBase64`),
  threaded through `PluginContext` → `ViewModelDeps`.
- Attachments are only honored by the provider at message creation (existing
  behavior); attaching to an already-saved draft is out of scope for v1 and the
  button is disabled in `editDraft` mode.

### Shared note commands

The bodies of the two existing palette commands ("Create email from note" /
"…with note attached") move out of `main.ts` into named host functions
(`composeFromNote`, `composeWithNoteAttached`). The palette commands and the
ribbon both call them; the ribbon receives them as `MailView` → `App` props,
following the context-menu-handler pattern.

## Removed UI

- Sidebar: "New message" and "New folder" buttons.
- Reading pane: the `.oe-reading-actions` row (Reply … Delete, Edit, Save to
  vault, collapse ✕). The reading pane's own close ✕ in the subject header
  remains. *Collapsing the pane* keeps a path: the header ✕ already closes the
  thread; the collapse control moves into the Home tab as a **Close pane**
  toggle in the Manage group (calls the existing `onCollapse` behavior).
- Composer: the bottom `.oe-composer-actions` row.

## Collapse and settings

Double-clicking a tab toggles collapse (tab strip only), as in `ribbon-bar`.
Two new prefs on `settings.prefs`, mirroring `ribbon-bar`:
`ribbonEnabled` (default `true`) and `ribbonCollapsedByDefault` (default
`false`), surfaced in the settings tab. When disabled, the ribbon is not
rendered and the removed buttons do **not** return — this is an explicit
trade-off of "move, don't duplicate"; the toggle is a debugging escape hatch,
and the spec accepts the missing-actions consequence. (If this proves wrong, a
follow-up can add a fallback toolbar.)

Styling uses Obsidian CSS variables only; the ribbon uses `overflow-x: auto`
so narrow panes scroll rather than wrap.

## Testing

- `registry.test.ts`: `enabled` predicates per context (Drafts/Trash/Archive,
  custom vs system folder, sending), `visibleTabs`, Move options excluding the
  active mailbox.
- `ribbon.smoke.test.ts`: renders tabs/groups, click → action called, disabled
  state, double-click collapse, Message tab appears/auto-selects with a
  composer and reverts on close.
- Migrate existing tests: reading-pane action tests and composer button tests
  become ribbon tests (same `data-action` attributes preserved on buttons);
  `app.smoke.test.ts` updated for removed sidebar buttons and the lifted
  `expandedId`.
- `ViewModel.addComposerAttachment` unit test.
- Verification: `tsc`, full suite, build, manual pass in the dev vault
  (including collapse, contextual tab switching, narrow-width scrolling, and a
  light/dark theme check).

## Out of scope (v1)

User-customizable ribbon, keyboard-shortcut hints, a separate Send/Receive tab,
mobile layout, attaching notes to an already-saved draft, a fallback toolbar
when the ribbon is disabled.
