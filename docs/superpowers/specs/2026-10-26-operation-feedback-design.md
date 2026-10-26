# Operation Feedback — Design

## Goal

Give the user visible feedback while a **delete, archive or move** is running.
Today these wait on a bounded-concurrency round trip to Graph (`actOnThreads`,
`actOnMessage` in `view-model.ts`), then a cache write and a list reload; the
user sees nothing until the rows vanish, and a large selection can look like a
dead click.

## Decisions (agreed with the user)

- **Pending state, not optimistic removal ("option A").** Rows stay on screen,
  marked as pending, until the server has answered. The existing flow (act →
  drop succeeded rows from the cache → reload) is unchanged; this feature only
  adds visibility on top of it. No rollback machinery is needed.
- **Scope: delete, archive and move only** — from row buttons, the context
  menu, the bulk bar, the ribbon and the reading pane. Flag, pin and
  read/unread are already optimistic; contact deletion is out of scope.
- **Two layers of feedback:** a per-row pending state (immediate, where the
  user is looking) and an aggregate progress toast (only for operations that
  take long enough to need one).

## Non-goals

Optimistic removal with rollback; undo; cancelling an in-flight operation; a
status-bar item (hidden on mobile); feedback for flag/pin/read, contacts,
send/save-draft or sync (sync already has `showSyncingToast`); queuing
operations offline.

## Architecture

### Progress hook (`src/util/concurrency.ts`)

`mapSettledLimit` gains an optional fourth parameter:

```ts
onSettled?: (result: PromiseSettledResult<R>, index: number) => void
```

Called once per item as it settles (success or failure), in completion order,
before the overall promise resolves. Results and ordering of the returned
array are unchanged; omitting the callback is identical to today, so the
mark-read path is untouched. A throwing callback must not break the pool —
it is wrapped in try/catch and ignored.

### Operation state (`src/view/pending-ops.ts`, `src/view/view-model.ts`)

The type, the derived helpers, the toast text and `OPERATION_TOAST_DELAY_MS`
live in `src/view/pending-ops.ts` (pure, no `"obsidian"` import) to keep
`view-model.ts` from growing; the view-model owns the state and the
transitions.

```ts
export interface PendingOp {
  id: string;                         // unique per run (counter, not a message id)
  accountId: string;
  pastTense: "Deleted" | "Archived" | "Moved"; // the progress verb is derived from it
  destinationLabel?: string;          // moves only: the target mailbox's name
  threadIds: string[];                // rows to mark pending (empty for single-message ops)
  messageIds: string[];               // every message the op will touch
  total: number;                      // messageIds.length
  done: number;                       // settled so far, success or failure
}
```

- `ViewState.pendingOps: PendingOp[]` (initially `[]`).
- Registered in `actOnThreads` **after** the cached messages are gathered (so
  the "Couldn't find any messages" early return never registers anything) and
  removed in a `finally`, whatever happens — success, partial failure, or a
  throw from the cache/reload. A stuck pending op would leave rows inert
  forever, so the `finally` is the invariant to test.
- `done` is advanced from the `onSettled` callback; each advance is one
  `this.set({ pendingOps })` (immutable replace, like the rest of the state).
- `actOnMessage` (reading-pane single delete/archive) registers an op with
  `threadIds: []` and one `messageId`.
- Derived helpers exported from `pending-ops.ts`:
  `pendingThreadIds(state): Set<string>` and `pendingMessageIds(state):
  Set<string>`, both filtered to `state.activeAccountId` — an op started
  before an account switch keeps running (and keeps its toast) but must not
  mark the new account's rows.
- **Re-entry guard:** `actOnThreads` drops any `threadId` already in a pending
  op for that account before doing anything, and `actOnMessage` returns early
  for a pending message. This prevents double-sends from a double click, and
  a delete racing an archive on the same thread. If everything was filtered
  out it returns silently. `actOnThreads` also skips any *message* already in
  flight as a single-message op (the ribbon's Delete on one expanded message),
  so a thread-level action on the same conversation can't send it twice.
- The selection is cleared of the acted threads **at start** instead of after
  completion, so the bulk bar disappears and cannot be re-triggered. Failed
  threads stay in the list, unticked, as they do today.
- `moveThreads` resolves `destinationLabel` from `state.mailboxes` at call
  time.

Rows are matched by `threadId`/`messageId` held in state, not by row object,
so a sync delta or reload landing mid-flight (which replaces `threads`) does
not lose the pending marking.

### Completion notice

- If the progress toast was shown (the operation took longer than the delay
  below), finish with one short Notice when no failure occurred: `Deleted 12
  messages`, `Archived 3 messages`, `Moved 12 messages to Archive`. Singular
  for one.
- If the operation finished before the toast appeared, say nothing: the rows
  disappearing is the confirmation, and a notice for every quick delete would
  be noise.
- Failure wording is unchanged (`Couldn't delete this thread.`, `Deleted 7 of
  12 messages — 5 failed.`, `errorMessage(err)`) and replaces the success
  notice. Failures are always announced, slow or not.

The view-model never imports `"obsidian"`; it only calls `deps.showNotice`.
To know whether the toast was shown, the **view** owns the toast (below) and
the view-model decides purely on elapsed time: `actOnThreads`/`actOnMessage`
record the start time and apply the same `OPERATION_TOAST_DELAY_MS` constant
(from `pending-ops.ts`) when choosing whether to send the success notice.

## UI

### Progress toast (`src/view/operation-toast.ts`, `App.svelte`)

`refresh-toast.ts` shows a persistent Notice with an icon; this generalises the
pattern:

```ts
export interface OperationToast { update(text: string): void; hide(): void }
export function showOperationToast(text: string): OperationToast
```

- Built like `showSyncingToast` (icon span + text in a `DocumentFragment`,
  `new Notice(frag, 0)`), but `update` rewrites the text node in place rather
  than creating a new Notice. `hide()` is idempotent.
- `App.svelte` has an `$effect` on `state.pendingOps`: while the list is
  non-empty it arms a timer for `OPERATION_TOAST_DELAY_MS` (300 ms); when the
  timer fires it creates the toast, and thereafter calls `update` whenever the
  ops change. When the list empties (or the view unmounts) it clears the timer
  and hides the toast. Sub-300 ms operations therefore never flash a toast.
- Text comes from a pure function `describePendingOps(ops): string`:
  - one op, one message: `Deleting…`
  - one op: `Deleting 12 messages… 7/12`
  - several ops with the same verb: summed — `Deleting 20 messages… 9/20`
  - mixed verbs: `Working on 2 operations… 9/20`
  - a move appends the destination when there is exactly one op:
    `Moving 12 messages to Archive… 7/12`
- Progress is counted in **messages**, because that is the unit of server
  work (`actOnThreads` acts per message), even though the list shows threads.
- The sync toast and the operation toast are independent Notices and may be on
  screen together.

### Thread row (`ThreadRow.svelte`, `MessageList.svelte`)

- New prop `pending?: boolean`, passed from `MessageList` using
  `pendingThreadIds`.
- When pending: `is-pending` class (dimmed), `aria-busy="true"`, a small
  spinner with a "Working…" label (Lucide `loader` rendered with the existing
  `icon` action) in place of the hover buttons, the
  select checkbox disabled, `draggable` off, and click/Enter/Space inert — the
  thread is about to disappear, so opening it would race the reload.
- The row's context menu is suppressed while pending.

### Reading pane

No change. `MessageBlock` has no delete/archive controls of its own — those
actions live in the ribbon — so there is nothing to disable in the pane, and
reading a pending conversation stays possible.

### Bulk bar and ribbon

- Because selection is cleared at start, the bulk bar needs no change.
- The ribbon's Archive/Delete `enabled` predicates (in
  `view/ribbon/registry.ts`) gain `&& !c.targetMessagePending` on the
  no-selection branch, and Move gains `&& !c.openThreadPending`. `RibbonContext`
  gets both fields, computed in `App.svelte` from `pendingMessageIds` /
  `pendingThreadIds`. A ticked selection still enables them: those threads are
  unticked the moment their operation starts, so what remains ticked is not
  pending. Row buttons and the context menu are covered by the re-entry guard
  and the row's inert state.

### Styling (`styles.css`)

```css
.oe-thread-row.is-pending { opacity: 0.55; }
.oe-row-spinner svg { animation: oe-spin 1s linear infinite; }
@media (prefers-reduced-motion: reduce) { .oe-row-spinner svg { animation: none; } }
```

`styles.css` has no `@keyframes` today (the old refresh spinner was removed in
favour of the toast), so this adds `oe-spin`; the operation toast's icon opts
in with an `oe-spin` class so the sync toast's mail icon stays still. Colours come from Obsidian CSS
variables only.

## Error handling

| Situation | Behaviour |
| --- | --- |
| All messages fail | op removed, rows return to normal, existing "Couldn't …" notice |
| Some messages fail | op removed, succeeded rows drop out, failed rows return to normal, existing "N of M — K failed" notice |
| Cache read/write or reload throws | `finally` removes the op; `errorMessage` notice (as today) |
| No cached messages for the threads | nothing registered; existing "Couldn't find any messages" notice |
| Account switched mid-flight | op continues; toast keeps updating; new account's rows are not marked |
| Same thread acted on twice | second call filtered by the re-entry guard |
| View closed mid-flight | effect cleanup hides the toast and clears the timer; the op still completes in the view-model |
| Delete confirmation prompt (Trash/search) | feedback starts only after the user confirms, since the op is registered inside `actOnThreads` |

## Testing (vitest + jsdom, existing conventions)

- `mapSettledLimit`: `onSettled` called once per item with the right index and
  result, for fulfilled and rejected items; a throwing callback does not
  affect results; omitting it behaves as before.
- View-model (`tests/view/view-model.test.ts`, using `FakeProvider` with
  controllable deferred promises):
  - op appears in `pendingOps` while the provider call is unresolved, with
    `done` advancing per settled message, and is gone afterwards;
  - removed on all-fail, partial-fail, and when the cache/reload throws;
  - `pendingThreadIds` excludes other accounts' ops;
  - re-entry guard: second delete/archive/move of the same thread is ignored;
    mixed new + pending ids only act on the new ones;
  - selection cleared at start;
  - move records `destinationLabel`;
  - `actOnMessage` registers a message-level op and no thread ids;
  - success notice only when the op outlasted `OPERATION_TOAST_DELAY_MS`
    (fake timers); failure notice always.
- `describePendingOps`: the single/plural/summed/mixed/move cases.
- `operation-toast`: update rewrites in place; `hide` is idempotent.
- Components: `ThreadRow` pending (class, `aria-busy`, spinner, disabled
  checkbox, inert click); ribbon registry predicates with
  `targetMessagePending` / `openThreadPending`; App smoke — toast appears only after
  the delay, updates, and is hidden when the op finishes.
- `main.ts` untested by convention; no change is expected there.

## Staging

One PR, built in shippable order: (1) `onSettled` + `PendingOp` state,
re-entry guard and completion notices; (2) row and reading-pane pending
states with styling; (3) progress toast and `describePendingOps`; (4) ribbon
predicates.

## Release

New feature → minor bump, **0.13.0**.
