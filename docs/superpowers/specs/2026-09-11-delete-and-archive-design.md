# Delete & Archive Design

## 1. Overview

Sub-project 3 (SP3, per the README roadmap) adds the ability to delete and archive email, at both the thread level (from the message list) and the individual-message level (from the reading pane). This builds on the provider abstraction and `ViewModel` conventions established in SP1 (read/search) and SP2 (compose/send).

**Approved decisions:**

- Both delete and archive ship together — they share nearly identical plumbing (a provider method, a button, a list refresh), so building one without the other would be wasted motion.
- Actions are available at both granularities: a button on each `ThreadRow` in the message list (acts on the whole conversation) and a button on each expanded `MessageBlock` in the reading pane (acts on that one message).
- **Delete is Graph-native soft-delete.** Calling Microsoft Graph's `DELETE /me/messages/{id}` moves a message to Deleted Items from any other folder, but permanently removes it if the message is already in Deleted Items. This client makes no client-side distinction between "soft" and "permanent" delete — it always issues the same Graph call, and Graph's own behavior does the right thing based on where the message currently lives.
- **Deleting from the Trash (Deleted Items) folder is therefore a permanent, irreversible action**, and gets a confirmation prompt first. Deleting from anywhere else is recoverable (the message lands in Deleted Items) and fires immediately, no prompt.
- **No bulk/multi-select in this round.** One thread or message at a time, mirroring the button-per-row pattern already used for reply/reply-all/forward.
- **Thread-level actions act on the whole conversation**, not just the most recent message — every message sharing that `threadId` gets deleted/archived.
- Out of scope: restoring a message out of Trash/Archive back to Inbox, mark as read/unread, flag, moving to arbitrary custom folders, bulk selection. These remain separate roadmap items.

## 2. Provider abstraction

Two new methods on `MailProvider` (`src/providers/types.ts`):

```ts
export interface MailProvider {
  // ...existing methods (SP1 + SP2)...

  /** Deletes a message. Graph moves it to Deleted Items from any other
   *  folder; deleting a message already in Deleted Items permanently
   *  removes it. No client-side branching — Graph's own semantics handle
   *  the soft/permanent distinction based on the message's current folder. */
  deleteMessage(id: string): Promise<void>;

  /** Moves a message to the Archive well-known folder. */
  archiveMessage(id: string): Promise<void>;
}
```

**`GraphProvider` implementation** (reuses the `request<T>` helper already generalized in SP2):

```ts
async deleteMessage(id: string): Promise<void> {
  await this.request<void>(`/me/messages/${id}`, "DELETE");
}

async archiveMessage(id: string): Promise<void> {
  await this.request<void>(`/me/messages/${id}/move`, "POST", { destinationId: "archive" });
}
```

Both reuse the exact same auth/retry/error-classification path already proven in SP2 (401/403 → `AuthError`, 429/5xx → retry via `withRetry`, other non-2xx → `ProviderError`).

**`FakeProvider`** gets matching in-memory implementations: a `deleteMessage(id)` that removes the message from its fake store (or moves it to a fake "deleted" bucket so tests can assert on permanent-vs-recoverable behavior if needed), and an `archiveMessage(id)` that moves it to a fake "archive" bucket — mirroring the existing `sentLog`/`drafts` pattern from SP2's `FakeProvider` additions, so `ViewModel` tests exercise real state transitions rather than assertions against a mock.

## 3. ViewModel actions

Four new methods on `ViewModel` (`src/view/view-model.ts`):

```ts
async deleteMessage(messageId: string): Promise<void>;
async archiveMessage(messageId: string): Promise<void>;
async deleteThread(threadId: string): Promise<void>;
async archiveThread(threadId: string): Promise<void>;
```

**Single-message actions** (`deleteMessage`, `archiveMessage`):
1. Call the provider method for `messageId`.
2. On success, remove the message from the local cache (`cache.deleteMessages(accountId, [messageId])`) and reload the current list (`reloadList()`), matching the existing refresh pattern used elsewhere in the file.
3. If the acted-on message's thread was open in the reading pane, close it (`closeThread()`-equivalent), since the message it was showing no longer belongs in the current mailbox view.
4. On failure, set `notice` following the existing error-message conventions (including the `AuthError` → re-authenticate hint already established in SP2).

**Thread-level actions** (`deleteThread`, `archiveThread`):
1. Look up every message in the conversation via the existing `cache.getThreadMessages(accountId, threadId)`.
2. Call the provider method for each message **concurrently** (`Promise.allSettled`, not sequential) — these are independent Graph calls with their own retry logic, so there's no reason to serialize them.
3. Remove only the successfully-acted-on messages from the cache, then reload the list.
4. If any calls failed, report partial failure explicitly via `notice` (e.g. `"Archived 2 of 3 messages — 1 failed."`) rather than silently claiming full success. Never leave the user believing an action fully succeeded when it partially didn't.
5. If the acted-on thread was open in the reading pane, close it.

## 4. Confirmation for permanent delete

- A new `isTrashMailbox` derivation in `App.svelte`, mirroring the existing `isDraftsMailbox` pattern: `state.mailboxes.find(m => m.id === state.activeMailboxId)?.kind === "trash"`.
- Deleting from any mailbox **other than** Trash fires immediately — it's recoverable.
- Deleting **from** Trash shows a confirmation prompt first ("Permanently delete this message?" / "...this thread?"), reusing the same lightweight prompt-banner component/styling already built for the compose-switch prompt in SP2 (not a native `confirm()` — keeps the UI consistent and testable the same way as everything else in this app). Only explicit confirmation triggers the actual `deleteMessage`/`deleteThread` call.

## 5. Where the buttons appear

| Mailbox kind | Reply/Reply-all/Forward (existing) | Archive | Delete |
|---|---|---|---|
| Inbox / custom folders | shown | shown | shown |
| Sent | shown | shown | shown |
| Drafts | hidden (Edit only, existing) | hidden | shown |
| Archive | shown | hidden (redundant) | shown |
| Trash | hidden | hidden | shown (with confirm) |
| Spam/Junk | shown | shown | shown |

Both `ThreadRow.svelte` (list, thread-level actions) and `MessageBlock.svelte` (reading pane, message-level actions) follow this same table. `ThreadRow` currently has no action buttons at all — this is the first task to add any; `MessageBlock` already has a `.oe-message-actions` block from SP2 that Archive/Delete join.

## 6. Testing strategy

- **Provider tests**: `GraphProvider.deleteMessage`/`archiveMessage` — assert exact HTTP verb/URL/body per the SP2 test conventions (`call.method`, `call.url`, `JSON.parse(call.body)`).
- **ViewModel tests**: exercise real behavior via `FakeProvider` — single-message delete, single-message archive, thread-level delete (including a partial-failure case via a spy that rejects for one message id), thread-level archive, and confirming the reading pane closes when its open thread is acted on.
- **Component tests**: `ThreadRow`/`MessageBlock` button visibility per the table in §5 (one test per mailbox kind, or a parameterized set), and the Trash-confirm-prompt flow (mirroring the `ReadingPaneHost`/prompt test pattern already established for the compose-switch prompt).

## 7. Out of scope

- Bulk/multi-select actions.
- Restoring a message from Trash or Archive back to Inbox.
- Mark as read/unread, flag (separate roadmap items).
- Moving to arbitrary custom folders (only Archive and Deleted Items are targeted by this feature).
