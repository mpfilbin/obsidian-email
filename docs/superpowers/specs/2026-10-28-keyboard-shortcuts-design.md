# Keyboard Shortcuts — Design

## Goal

Let users triage mail from the keyboard: flag, pin, archive and delete the open
conversation, and step through the list one conversation at a time.

## Decisions (agreed with the user)

- **Two layers.**
  1. **Obsidian commands** for every action, so users can bind their own keys in
     Settings → Hotkeys. No default hotkeys are assigned (Obsidian's guidance for
     plugins, and plain letters would collide with note editing).
  2. **Built-in single-key shortcuts** that work out of the box, but only while
     the mail view has focus. A setting turns them off.
- **j / k open as you go.** Next/previous opens that conversation in the reading
  pane, as a click would, and scrolls its row into view.
- **Auto-advance.** Archiving or deleting the open conversation with a key opens
  the next one straight away, so a whole inbox can be triaged by tapping one key.

## Non-goals

A shortcut help modal or `?` overlay; bulk flag/pin from the keyboard; keys for
reply/forward/mark read; a movable cursor separate from the open conversation;
rebinding the built-in keys (rebind through Obsidian commands instead); keys in
the Contacts view or the composer; wrapping at the ends of the list.

## Key bindings (built-in layer)

| Key | Action | Notes |
| --- | --- | --- |
| `j` | Next conversation | opens it; no wrap at the end |
| `k` | Previous conversation | opens it; no wrap at the start |
| `x` | Tick / untick | open conversation's selection checkbox; ticked rows are what `e` and `#` then act on |
| `u` | Mark read / unread | read if anything is unread, else unread (newest message, as the bulk bar does); acts on ticked rows when any are ticked |
| `f` | Flag / unflag | open conversation, same toggle as the row button |
| `p` | Pin / unpin | open conversation |
| `e` | Archive | not offered in Drafts, Archive or Trash |
| `#` or `Delete` | Delete | confirmation rules unchanged (Trash, search results) |

Held-key repeat is ignored for `x u f p e # Delete` (a held key would act on the
whole list) and honoured for `j`/`k`.

### When a key is handled

The handler lives on the mail view's root element, never on `document`, so it
cannot see keystrokes aimed at notes or other panes. It ignores an event when:

- the shortcut setting is off;
- `ctrlKey`, `metaKey` or `altKey` is down (Shift is allowed only because `#`
  needs it), `isComposing` is true, or `defaultPrevented` is already set (an
  Obsidian hotkey got there first);
- the target is an `input`, `textarea`, `select` or `contenteditable` element —
  the search box, the composer's Quill editor, contact forms, folder rename;
- the view is in Contacts mode, or a top-level composer has replaced the thread;
- a confirmation or unsaved-composer prompt is showing (`pendingDelete`,
  `pendingSwitch`).

Buttons inside a row already swallow keydown (so Enter/Space don't also open the
row); that stays, which means shortcuts don't fire while a row *button* has focus
— only while the row or the list does.

### Focus

Keys only reach the view while focus is inside it. Deleting or archiving removes
the focused row, which would drop focus to `<body>` and silently kill every later
key. So:

- The grid root gets `tabindex="-1"`. After a shortcut action, whenever the list
  next changes and focus has been *lost* (it is on `<body>` because the focused
  row was removed), it is moved to the grid root. Focus the user moved elsewhere
  — a note in a split, another pane — is never pulled back: a pointer press
  anywhere, or focus leaving the grid for another element, ends the keyboard
  session, so a background refresh can't steal focus mid-typing.
- `j`/`k` and auto-advance focus the newly opened row (`preventScroll`) and call
  `scrollIntoView({ block: "nearest" })`, so the highlighted row is always the
  focused one.

## Architecture

### One dispatcher, two entry points (`App.svelte`)

Delete and archive must pass through the same guards as the ribbon and row
buttons: the unsaved-composer prompt (`requestRowAction`/`requestSwitch`) and the
delete confirmation (`requestDelete`). Those live in `App.svelte`'s local state,
so the palette cannot call the view-model directly (the existing "Open contacts"
command has to special-case this). Instead `App.svelte` exports two functions and
**both layers go through them**:

```ts
export type KeyAction = "next" | "previous" | "select" | "read" | "flag" | "pin" | "archive" | "delete";
export function canPerform(action: KeyAction): boolean;
export function perform(action: KeyAction): void;
```

- `canPerform` is derived from current state: Mail mode and no top-level composer;
  `next`/`previous` need a neighbour; `flag`/`pin`/`delete` need an open thread;
  `archive` additionally needs an archivable mailbox (the ribbon's `archivable`
  rule — not Drafts, Archive or Trash). It never reports true for a conversation
  that is pending (see Operation Feedback).
- `perform` re-checks `canPerform`, then:
  - `flag`/`pin` → `vm.toggleThreadFlag` / `vm.toggleThreadPin` on the open thread.
  - `archive`/`delete` → with conversations ticked, the existing
    `bulkArchive`/`bulkDelete` on the selection (as the ribbon does, no
    auto-advance); otherwise on the open conversation with auto-advance.
  - `next`/`previous` → `requestSwitch(() => vm.openThread(id))`.
- `MailView` keeps the handle `mount()` returns and exposes `canPerform` /
  `perform` to `main.ts`. A key press in the DOM calls `perform` directly.

Archive and delete here act on the **conversation** (like the row buttons and
most mail clients), not on the single expanded message the ribbon's Delete uses.

### Pure helpers (`src/view/shortcuts.ts`, no `"obsidian"` import)

```ts
keyToAction(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat">): KeyAction | null
shouldIgnoreTarget(target: EventTarget | null): boolean   // input/textarea/select/contenteditable
adjacentThreadId(threads, fromId: string | null, direction: 1 | -1, skip: ReadonlySet<string>): string | null
advanceTarget(threads, openId: string, skip: ReadonlySet<string>): string | null
```

- `adjacentThreadId` walks `state.threads` in list order (pinned first, then by
  date — exactly what is on screen), skipping `skip`. With nothing open, `next`
  yields the first row and `previous` yields `null`. If `fromId` is not in the
  list (a search changed the rows) it behaves as "nothing open".
- `advanceTarget` picks the next non-pending row after the open one, falling back
  to the nearest earlier non-pending row, else `null`.
- `skip` is `pendingThreadIds(state)` so a row mid-delete is never opened.

### Closing the double-press gap (`view-model.ts`)

`pendingOps` only fills in once `actOnThreads` has read the thread's messages
from the cache, so a second call landing in that gap — a key tapped twice — would
pass the re-entry guard and send the work again. `actOnThreads` therefore also
takes a synchronous claim on its thread ids (`claimedThreads`) before it first
awaits, and releases it in its `finally`.

### Auto-advance (builds on Operation Feedback)

Operation Feedback keeps a row on screen, marked pending, until the server
answers. If the pane waited for that, tapping `e` twice would hit the re-entry
guard (the open thread is still the pending one) and triage would stall on the
network. So for a keyboard archive/delete of the open conversation:

1. compute `next = advanceTarget(...)` **before** acting;
2. start the action (`vm.archiveThread` / `vm.deleteThread`, not awaited);
3. immediately `vm.openThread(next)` if `next` is non-null, inside the same
   `requestRowAction` callback so the unsaved-composer prompt and the delete
   confirmation still gate both steps.

When the operation later settles, `actOnThreads` only closes the pane if the
*current* open thread is among the acted ones (existing check), so the new
conversation is left alone. If the action fails, the row returns to normal and
the existing failure notice appears; the user has simply already moved on. With
no `next` (last remaining conversation) nothing is opened and the pane closes on
completion, as it does today.

### Commands (`src/host/palette.ts`, `src/main.ts`)

`buildPaletteCommands` gains a `mail` host handle and eight commands:

| id | name |
| --- | --- |
| `next-email` | Next email |
| `previous-email` | Previous email |
| `toggle-select` | Select or deselect email |
| `toggle-read` | Mark email read or unread |
| `toggle-flag` | Flag or unflag email |
| `toggle-pin` | Pin or unpin email |
| `archive-email` | Archive email |
| `delete-email` | Delete email |

Each is a `checkCallback`: available only when the **active view is the mail
view** (`getActiveViewOfType(MailView)`) and `canPerform(action)`. Gating on the
active view means a hotkey such as `Ctrl+E` cannot archive mail while the user is
typing in a note. `perform` runs through the same dispatcher as the keys, so the
guards apply identically. The commands are always registered, regardless of the
built-in-keys setting.

### Settings (`src/settings/settings-store.ts`, `settings-tab.ts`)

- `Prefs.keyboardShortcuts: boolean`, default `true`; old files load fine through
  the existing `{ ...DEFAULT_SETTINGS.prefs, ...obj.prefs }` merge.
- Mirrored into `ViewState.keyboardShortcuts` by `syncPrefs`, like
  `ribbonEnabled`, so the view re-reads it after the user visits the settings tab.
- Settings tab: a "Keyboard shortcuts" toggle whose description lists the keys and
  says how to bind the commands instead.

### Discoverability

Row buttons and ribbon buttons gain the key in their tooltip when shortcuts are
on (`Archive (e)`, `Flag (f)`, …). `ThreadRow` takes a `keyHints` prop; ribbon
commands carry an optional `key`, and `RibbonContext` gains `keyboardShortcuts`.
The accessible name (`aria-label`) stays the plain label. README gets a short "Keyboard shortcuts"
section with the table above and a note on binding the commands.

## Error handling

| Situation | Behaviour |
| --- | --- |
| Key pressed with nothing to act on | silently ignored (no notice) |
| `j` at the last row / `k` at the first | stays put |
| Archive pressed in Drafts, Archive or Trash | ignored (`canPerform` is false) |
| Delete in Trash or search results | existing confirmation; auto-advance happens only after confirming |
| Unsaved composer when navigating or acting | existing prompt; nothing happens until resolved |
| Archive/delete fails after auto-advance | existing failure notice; failed row returns to normal |
| Open conversation already pending | `canPerform` is false; re-entry guard still backs it up |
| Focus lost because the focused row was removed | refocused to the grid / new row |

## Testing (vitest + jsdom, existing conventions)

- `shortcuts.ts`: `keyToAction` for every key incl. `#`, `Delete`, `Shift+3`,
  modifiers rejected, `repeat` honoured only for `j`/`k`; `shouldIgnoreTarget`
  (input, textarea, select, contenteditable, plain div); `adjacentThreadId`
  (nothing open, ends, skipped pending rows, unknown `fromId`); `advanceTarget`
  (next, falls back to previous, only row, all others pending).
- App smoke (`fakeVm` + keydown events on the grid): `j`/`k` call `openThread`
  with the right ids; `f`/`p` call the toggles; `e`/`#`/`Delete` archive/delete
  the open thread **and** open the neighbour; archive blocked in Trash/Drafts;
  delete in Trash asks first and advances only after confirming; ticked
  selection routes to the bulk actions with no advance; ignored when typing in
  the search box, with Ctrl/Meta/Alt held, in Contacts mode, with the composer
  open, while a prompt shows, with the setting off, and on a repeated action key;
  focus returns to the grid after an action removes the focused row.
- Palette: the eight commands exist; `checkCallback` is false off the mail view, with
  no open thread, or when archiving is not allowed; `perform` is called with the
  right action.
- Settings: `keyboardShortcuts` defaults to true, survives an old file, toggles
  through `updatePrefs`; view-model `syncPrefs` mirrors it.
- Tooltips: row and ribbon buttons show the key only when the setting is on.
- `main.ts` untested by convention.

## Staging

One PR, built in shippable order: (1) pure helpers and `canPerform`/`perform`;
(2) built-in key handler, focus handling and the setting; (3) auto-advance;
(4) palette commands and `MailView` handle; (5) tooltips and README.

## Release

New feature → minor bump, **0.14.0** (via `scripts/release.sh minor`, which needs
Node ≥ 26).
