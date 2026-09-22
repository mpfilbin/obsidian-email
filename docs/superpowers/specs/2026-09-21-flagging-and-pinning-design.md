# Flagging and Pinning — Design

## Goal

Let users **flag** messages for follow-up (synced to Outlook) and **pin** threads
to the top of the list (local to the plugin), with a **Flagged** view listing
everything flagged.

## Decisions (agreed with the user)

- **Flagging is server-backed.** Toggling a flag PATCHes the message's follow-up
  flag in Graph (`Mail.ReadWrite`, already granted — no new scope).
- **Pinning is local.** Graph has no API for Outlook's mail "pin" (the only
  "pinned" API is for Teams chat messages). Pins are stored in the plugin's own
  data, keyed by conversation, and are not visible in Outlook.
- **Granularity: both.** In the thread list, flag/pin act on the whole thread
  (matching Archive/Delete/Move). In the reading pane, each message has its own
  flag toggle. A thread row shows the flag if any of its messages is flagged.
- **Surfaces (all four):** thread-row hover buttons and indicators; ribbon
  buttons; the row right-click menu; a **Flagged** view in the folder pane.
- **Optimistic updates** with rollback for flags (see "Toggles").
- Pinned threads always sort to the top of the mailbox list.

## Non-goals

Outlook's *completed* checkmark and due/start dates (a completed flag reads as
unflagged, as the existing mapper already does); pins visible in Outlook or
other mail clients; a count badge on Flagged; keyboard shortcuts; read/unread
(no write path exists today).

## Key constraint discovered

The cache prunes old summaries (`RETENTION`: once a mailbox exceeds 2000
messages, anything older than 90 days is deleted) and backfill only fetches the
newest ~200 per folder. A cache-only Flagged view, or a pinned thread, would
silently lose old items. Hence: pruning keeps flagged messages and pinned
threads, and the Flagged view fetches from the server and upserts into the
cache.

## Architecture

### Provider (`src/providers/types.ts`, `ms-graph/graph-provider.ts`, `fake-provider.ts`)

```ts
interface MailProvider {
  /** PATCH /me/messages/{id} { flag: { flagStatus: "flagged" | "notFlagged" } } */
  setMessageFlag(id: string, flagged: boolean): Promise<void>;
  /** GET /me/messages?$filter=flag/flagStatus eq 'flagged'&$select=…  (paged like search) */
  listFlaggedMessages(pageToken?: string): Promise<Page<MessageSummary>>;
}
```

- Both go through the existing `request()`; a 401/403 stays `AuthError` (mail
  semantics — these are mail writes, unlike contacts).
- Delta sync already carries flag changes (`mapGraphSummaryPatch` maps `flag`
  → `flagged`), so flags changed elsewhere flow into the cache unchanged.
- `FakeProvider` implements both (a flag change is logged so `syncSince`
  reports it) and the mail contract suite gains cases for them.
- **Open item to verify during implementation:** Graph's restrictions on
  `$filter=flag/flagStatus eq 'flagged'` (combining with `$orderby`, paging
  behaviour). If it misbehaves, fall back to querying per folder.

### Cache (`src/cache/mail-cache.ts`)

- `listFlaggedMessages(accountId)`: scan the account's messages where
  `flagged`, excluding messages whose only mailboxes are Trash/Junk (by
  mailbox kind), newest first.
- `pruneAccount(accountId, now, { keepThreadIds })`: `pruneSummaries` never
  deletes a row that is `flagged` or whose `threadId` is in `keepThreadIds`.
- `setFlagged(accountId, ids, flagged)`: a flag-only write used for the
  optimistic update and its rollback. It merges onto an existing row and never
  creates one, and never touches `mailboxIds` — `patchMessages` is not used
  here because its placeholder branch would resurrect a deleted message and its
  `mailboxIds` overwrite could undo a concurrent move.

### Pins (`src/settings/settings-store.ts`)

- `PluginSettings.pins: Array<{ accountId: string; threadId: string; pinnedAt: number }>`
  in `data.json`; `migrate` defaults it to `[]` (schemaVersion unchanged; old
  files load fine). Because it lives in `data.json`, Obsidian Sync carries pins
  between devices.
- API: `isPinned(accountId, threadId)`, `pin`, `unpin`,
  `pinnedThreadIds(accountId): Set<string>`. `removeAccount` drops that
  account's pins.
- Keyed by `threadId` (Graph `conversationId`), which is stable when a thread
  is moved/archived; message ids are not.

### Sync (`src/sync/sync-engine.ts`)

`SyncEngineDeps.getPinnedThreadIds(accountId)` (from settings) is passed to
`cache.pruneAccount` so pinned threads survive pruning. `PluginContext` wires it.

### View-model (`src/view/view-model.ts`)

- `ThreadView` gains `flagged` (any message flagged) and `pinned`;
  `groupThreads(messages, pinnedIds)` sorts pinned first (newest activity first
  within each group). Search results are not reordered.
- `reloadList`: after loading the mailbox's rows, also load each pinned
  thread's messages that belong to the active mailbox
  (`cache.getThreadMessages` filtered by `mailboxIds`), so a pinned thread older
  than the loaded page still shows.
- **Toggles**
  - `toggleThreadFlag(threadId)`: if ANY message is flagged, unflag all;
    otherwise flag all — the same "any message flagged" test that drives
    `ThreadView.flagged`, so the control's label, `aria-pressed` and action
    always agree (a partially flagged thread reads as flagged and clicking it
    clears the thread). Only the messages whose state differs are sent, and the
    whole cached conversation is acted on even when the visible row holds only
    part of it (the Flagged view shows just the flagged subset).
    `toggleMessageFlag(messageId)` for one message.
  - Optimistic: set the flag in the cache via `cache.setFlagged` (flag-only,
    and it never creates a row — so a rollback landing after a concurrent move
    or delete can neither undo the move nor resurrect the message),
    reload the list (and refresh `openMessages` summaries), then send the
    PATCHes via `Promise.allSettled`; on failure write the previous values back
    for the failed messages, reload, and toast — "Flagged N of M" for partial
    failure, otherwise the existing `errorMessage` text. Nothing is queued
    offline.
  - `toggleThreadPin(threadId)`: `SettingsStore.pin/unpin`, reload; on a
    persist failure revert and toast.
  - A sync delta landing between click and response could briefly show the old
    value; the next sync corrects it.
- **Flagged view**
  - State `flaggedActive: boolean` alongside `activeMailboxId` (a virtual
    entry, not a mailbox). `selectMailbox` clears it; `selectFlagged()` sets it
    and clears the search and the composer — exactly what `selectMailbox` does,
    which means the open thread is left alone.
  - Shows cached flagged threads immediately, then (if online) fetches
    `provider.listFlaggedMessages`, upserts into the cache and reloads; Load
    more follows the page token. Server failure keeps the cached list and
    toasts; offline is silent.
  - `reloadList` branches on `flaggedActive`. The sync-change handler reloads
    it the same way. `refreshMailboxes`' "active mailbox vanished → Inbox"
    fallback is skipped while it is active.
  - Thread actions (archive/delete/move) work on its rows through the existing
    `actOnThread` path. `otherMailboxes` (ribbon Move destinations) is every
    mailbox in this view.

## UI

- **Thread row (`ThreadRow.svelte`):** flag and pin icons on the row when set;
  hover buttons "Flag/Unflag" and "Pin/Unpin" beside Archive/Delete (same
  `data-action` pattern); `is-pinned` accent so the pinned group reads as one.
- **Reading pane (`MessageBlock.svelte`):** a per-message flag toggle in the
  header (`aria-pressed`), click does not toggle expand/collapse.
- **Folder pane (`MailboxList.svelte`):** a "Flagged" entry with a flag icon
  above the folders, active when `flaggedActive`. It is not a drop target.
- **Ribbon:** Home tab gets a "Mark" group with **Flag** and **Pin**, acting on
  the open thread, `pressed` while set, mail-mode only (added to `MAIL_ONLY`).
  `RibbonContext` gains `openThreadFlagged`, `openThreadPinned`; `RibbonActions`
  gains `toggleFlag`, `togglePin`.
- **Context menu (`main.ts`):** `ThreadContextMenuHandler` receives an actions
  object (`{ candidates, onMove, flagged, pinned, onToggleFlag, onTogglePin }`)
  instead of extra positional args; adds Flag/Unflag and Pin/Unpin next to Move.
- **Icons:** Lucide `flag` and `pin` (unverified in Obsidian's bundled set —
  manual smoke item). `.svelte` files and `view-model.ts` never import
  `"obsidian"`.

## Error handling

| Situation | Behaviour |
| --- | --- |
| Flag PATCH fails (offline, auth, 404, …) | roll back cache, reload, toast (`errorMessage`) |
| Some messages of a thread fail | roll back only those, toast "Flagged N of M" |
| Pin persist (`saveData`) fails | revert the pin, toast |
| Flagged-view server fetch fails | keep cached list, toast; offline → silent |
| Message already deleted elsewhere | PATCH 404 → treated as failure (rollback + toast) |

## Testing (vitest + jsdom, existing conventions)

- Graph provider: PATCH body/URL for flag and unflag; `$filter` query and
  paging for `listFlaggedMessages`; auth mapping unchanged. `FakeProvider` +
  mail contract cases.
- Cache: flagged scan (excludes Trash/Junk, newest first); pruning keeps
  flagged rows and `keepThreadIds` threads while still pruning others.
- Settings: pins load/migrate from an old file; pin/unpin/`pinnedThreadIds`;
  `removeAccount` drops pins. Sync engine passes pinned ids to prune.
- View-model: optimistic toggle (state reflects instantly), rollback and toast,
  partial thread failure, thread toggle semantics (all→unflag, some→flag all),
  pin ordering including a pinned thread outside the loaded page, Flagged view
  lifecycle (select, cached-then-server, load more, offline, fallback skipped),
  `selectMailbox` clears it.
- Components: `ThreadRow` (icons, buttons, `is-pinned`), `MessageBlock` flag
  toggle (no expand), `MailboxList` Flagged entry; ribbon registry (Mark group,
  pressed, mail-only) and ribbon smoke; App smoke (wiring, Flagged view).
- `main.ts` untested by convention.

## Staging

One PR, built in shippable order: (1) flagging — provider, cache, view-model
toggles, row/reading-pane/ribbon/context-menu; (2) pinning — settings, sorting,
retention; (3) Flagged view.

## Release

New feature → minor bump, **0.6.0**.
