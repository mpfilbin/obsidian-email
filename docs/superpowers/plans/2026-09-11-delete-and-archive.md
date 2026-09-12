# Delete & Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to delete and archive email, at both the thread level (message list) and individual-message level (reading pane), for the Obsidian email plugin's Microsoft Graph provider.

**Architecture:** `MailProvider` gains two methods (`deleteMessage`, `archiveMessage`) mapped directly to Graph's native `DELETE /me/messages/{id}` and `POST /me/messages/{id}/move` calls — Graph's own server-side behavior already does exactly what's needed for the delete-from-Trash-is-permanent requirement, so no client-side soft/permanent branching exists anywhere in the provider layer. `ViewModel` adds four thin actions on top (`deleteMessage`, `archiveMessage`, `deleteThread`, `archiveThread`), reusing the existing `cache.deleteMessages`/`cache.getThreadMessages`/`reloadList` primitives already built in SP1. UI buttons are added to `ThreadRow.svelte` (currently has none) and `MessageBlock.svelte` (already has Reply/Reply-all/Forward/Edit from SP2), gated by mailbox kind per a fixed visibility table, with a lightweight confirm prompt (reusing SP2's compose-switch prompt styling) gating only the Trash-folder permanent-delete case.

**Tech Stack:** Same as SP1/SP2 (TypeScript strict, Svelte 5 runes, esbuild, Vitest+jsdom). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-delete-and-archive-design.md`

## Global Constraints

- **Both delete and archive ship together**; both are one-at-a-time (no bulk/multi-select this round).
- **Delete has no client-side soft/permanent branching.** `MailProvider.deleteMessage(id)` always issues the same call (`DELETE /me/messages/{id}` on `GraphProvider`). Graph's own server-side behavior moves the message to Deleted Items from any other folder, and permanently deletes it if it's already in Deleted Items. The client's ONLY job re: permanence is deciding whether to show a confirmation prompt first, based on which mailbox is currently active (`isTrashMailbox`) — never based on inspecting the message itself.
- **Thread-level actions act on every message in the conversation**, gathered via the existing `cache.getThreadMessages`, run **concurrently** (`Promise.allSettled`), with explicit partial-failure reporting via `notice` (never silently claim full success on partial failure).
- **`MailboxKind` already includes `"archive"` and `"trash"`** (added in SP1, with icons already wired in `mailbox-icons.ts` and well-known-folder mapping already in `graph-mappers.ts`'s `WELL_KNOWN_KIND`) — no new mailbox-listing work is needed; Trash and Archive folders already appear in the mailbox list today.
- **Button visibility table** (binding on both `ThreadRow.svelte` and `MessageBlock.svelte`):

  | Mailbox kind | Reply/Reply-all/Forward | Archive | Delete |
  |---|---|---|---|
  | Inbox / custom folders | shown | shown | shown |
  | Sent | shown | shown | shown |
  | Drafts | hidden (Edit only, existing) | hidden | shown |
  | Archive | shown | hidden | shown |
  | Trash | hidden | hidden | shown (confirm) |
  | Spam/Junk | shown | shown | shown |

  Delete is unconditionally shown everywhere; only its *behavior* (confirm vs. immediate) differs by mailbox. Archive is hidden exactly when `isDraftsMailbox || isArchiveMailbox || isTrashMailbox`. Reply/Reply-all/Forward's existing "hidden when `isDraftsMailbox`" condition (from SP2) must be extended to also hide when `isTrashMailbox`.
- **Confirmation only for Trash-folder delete.** A new `isTrashMailbox` derivation in `App.svelte` (mirroring the existing `isDraftsMailbox` pattern) gates a confirm prompt, reusing the exact `.oe-composer-prompt` CSS class already built in SP2 for visual consistency (no new prompt-banner CSS needed) but with its own distinct button classes/labels so its tests don't collide with the compose-switch prompt's tests. The two prompts are mutually exclusive in the template (`{#if pendingSwitch}...{:else if pendingDelete}...{/if}`).
- **Cache behavior on success**: remove the acted-on message(s) from the local cache via the existing `cache.deleteMessages(accountId, ids)` (already used elsewhere in this codebase) and `reloadList()` — this is a deliberate simplification approved in the spec: the message won't appear pre-populated in Archive/Trash until the next sync or on-demand load touches that mailbox (the existing `hasMore: rows.length === 0` fallback in `reloadList` already covers on-demand loading of not-yet-synced mailboxes, per SP1). Do not attempt to optimistically re-insert the message into the destination mailbox's cache — out of scope.
- **Errors follow existing conventions**: single-action failures use the existing private `errorMessage(err)` helper (special-cases `AuthError` with the re-authenticate hint); thread-level partial failures use a simpler generic count-based message and do not need per-error-type differentiation.
- **Conventional-commit messages** ending with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **TDD** throughout: failing test first, then implementation.
- **Verified facts from reading the current codebase** (not assumptions): `MessageSummary.bcc?: Address[]` already exists (added by SP2's final-review fix wave); `MailCache.deleteMessages(accountId, ids: string[]): Promise<void>` already exists; `GraphProvider`'s private `request<T>(url, method, body?)` helper (generalized in SP2) is reused for both new Graph calls; `GraphProvider.deleteDraft` currently duplicates the exact same `DELETE /me/messages/{id}` call this plan's `deleteMessage` also needs — Task 2 refactors `deleteDraft` to delegate to `deleteMessage` rather than leaving two copies of an identical Graph call.

---

## File Structure

**Modified:**
- `src/providers/types.ts` — add `deleteMessage(id)`, `archiveMessage(id)` to `MailProvider`.
- `src/providers/fake-provider.ts` — implement both.
- `src/providers/ms-graph/graph-provider.ts` — implement both; refactor `deleteDraft` to delegate to `deleteMessage`.
- `src/view/view-model.ts` — add `deleteMessage`, `archiveMessage`, `deleteThread`, `archiveThread`, plus two small private helpers (`actOnMessage`, `actOnThread`) to avoid duplicating the cache-cleanup/reload/notice logic between the delete and archive variants at each granularity.
- `src/view/components/ThreadRow.svelte` — restructure from a single `<button>` wrapper to a clickable `<div role="button">` (so it can contain real nested `<button>` action elements without invalid HTML nesting) and add Archive/Delete buttons.
- `src/view/components/MessageList.svelte` — thread the new per-thread callbacks/mailbox-kind props through to `ThreadRow`.
- `src/view/components/MessageBlock.svelte` — add Archive/Delete buttons; extend the existing Reply/Reply-all/Forward-vs-Edit branching to a three-way branch that also hides reply/forward in Trash.
- `src/view/components/ReadingPane.svelte` — thread `isArchiveMailbox`/`isTrashMailbox` and the new message-level callbacks through to `MessageBlock`.
- `src/view/App.svelte` — `isTrashMailbox`/`isArchiveMailbox` derivations, wiring for all four new actions, the permanent-delete confirm prompt.
- `styles.css` — extend the existing `.oe-message-actions` button styling to also cover a new `.oe-thread-actions` class (comma-joined selectors, no new visual design needed — same small-bordered-button treatment).
- Existing test files for every file above, extended in place.

---

## Task 1: `MailProvider` delete/archive methods + `FakeProvider` implementation

**Files:**
- Modify: `src/providers/types.ts`
- Modify: `src/providers/fake-provider.ts`
- Test: `tests/providers/fake-provider.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MailProvider.deleteMessage(id: string): Promise<void>` and `MailProvider.archiveMessage(id: string): Promise<void>` — Task 2 (GraphProvider) and Task 3 (ViewModel) consume these exact names/signatures.

- [ ] **Step 1: Extend `src/providers/types.ts`**

Add to the `MailProvider` interface (after `deleteDraft`):
```ts
  /** DELETE /me/messages/{id}. Graph moves the message to Deleted Items from
   *  any other folder, and permanently deletes it if it's already in Deleted
   *  Items — there is no client-side soft/permanent distinction here; Graph's
   *  own server-side behavior handles it based on the message's current folder. */
  deleteMessage(id: string): Promise<void>;

  /** Moves a message to the Archive well-known folder. */
  archiveMessage(id: string): Promise<void>;
```

- [ ] **Step 2: Write the failing test**

Append to `tests/providers/fake-provider.test.ts` (add a new `describe` block; reuse the file's existing `import`s):
```ts
describe("FakeProvider — delete/archive", () => {
  it("deleteMessage removes the message entirely", async () => {
    const p = new FakeProvider({ messages: [
      { id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { email: "a@x.com" }, to: [], cc: [],
        subject: "s", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: false },
    ] });
    await p.deleteMessage("m1");
    const page = await p.listMessages("INBOX");
    expect(page.items).toEqual([]);
  });

  it("deleteMessage throws for an unknown id", async () => {
    const p = new FakeProvider();
    await expect(p.deleteMessage("nope")).rejects.toThrow();
  });

  it("archiveMessage moves the message to the ARCHIVE mailbox", async () => {
    const p = new FakeProvider({ messages: [
      { id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { email: "a@x.com" }, to: [], cc: [],
        subject: "s", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: false },
    ] });
    await p.archiveMessage("m1");
    expect((await p.listMessages("INBOX")).items).toEqual([]);
    expect((await p.listMessages("ARCHIVE")).items.map((m) => m.id)).toEqual(["m1"]);
  });

  it("archiveMessage throws for an unknown id", async () => {
    const p = new FakeProvider();
    await expect(p.archiveMessage("nope")).rejects.toThrow();
  });

  it("both actions are visible to syncSince (log-backed)", async () => {
    const p = new FakeProvider({ messages: [
      { id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { email: "a@x.com" }, to: [], cc: [],
        subject: "s", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: false },
    ] });
    const cursor = await p.initialCursor();
    await p.archiveMessage("m1");
    const result = await p.syncSince(cursor);
    expect(result.upserts.map((m) => m.mailboxIds)).toEqual([["ARCHIVE"]]);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx vitest run tests/providers/fake-provider.test.ts`

- [ ] **Step 4: Implement in `src/providers/fake-provider.ts`**

Add these two methods to the `FakeProvider` class (after `deleteDraft`):
```ts
  async deleteMessage(id: string): Promise<void> {
    if (!this.messages.has(id)) throw new Error(`no such message: ${id}`);
    this.removeMessage(id);
  }

  async archiveMessage(id: string): Promise<void> {
    const m = this.messages.get(id);
    if (!m) throw new Error(`no such message: ${id}`);
    const moved: MessageSummary = { ...m, mailboxIds: ["ARCHIVE"] };
    this.addMessage(moved);
  }
```

(`addMessage` already both updates `this.messages` and pushes an `upsert` log entry — reusing it for `archiveMessage` is correct and avoids duplicating the log-push logic; `removeMessage` already both deletes from `this.messages` and pushes a `delete` log entry.)

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run tests/providers/fake-provider.test.ts`

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck` — expect it to now flag `graph-provider.ts` as not satisfying the extended `MailProvider` interface (missing `deleteMessage`/`archiveMessage`). This is intentional and expected — Task 2 closes that gap. Confirm the failure is specifically about `graph-provider.ts` missing these two methods, not some other unrelated type error.

- [ ] **Step 7: Commit**

```bash
git add src/providers/types.ts src/providers/fake-provider.ts tests/providers/fake-provider.test.ts
git commit -m "feat: add delete/archive methods to MailProvider, implement in FakeProvider

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `GraphProvider` delete/archive methods + `deleteDraft` refactor

**Files:**
- Modify: `src/providers/ms-graph/graph-provider.ts`
- Test: `tests/providers/ms-graph/graph-provider.test.ts`

**Interfaces:**
- Consumes: `MailProvider.deleteMessage`/`archiveMessage` (Task 1); the existing private `request<T>(url, method, body?)` helper.
- Produces: `GraphProvider` now fully satisfies `MailProvider` (Task 1's Step 6 typecheck gap closes here).

- [ ] **Step 1: Write the failing tests**

Append to `tests/providers/ms-graph/graph-provider.test.ts` (reuse the file's existing `resp()` helper and imports):
```ts
describe("GraphProvider — delete/archive", () => {
  it("deleteMessage DELETEs /me/messages/{id}", async () => {
    const req = vi.fn(async () => resp({}, 204));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.deleteMessage("m1");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/m1");
    expect(req.mock.calls[0][0].method).toBe("DELETE");
  });

  it("archiveMessage POSTs /me/messages/{id}/move with destinationId: archive", async () => {
    const req = vi.fn(async () => resp({}, 200));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.archiveMessage("m1");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/m1/move");
    expect(req.mock.calls[0][0].method).toBe("POST");
    expect(JSON.parse(req.mock.calls[0][0].body)).toEqual({ destinationId: "archive" });
  });

  it("deleteDraft still DELETEs /me/messages/{id} after the refactor", async () => {
    const req = vi.fn(async () => resp({}, 204));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.deleteDraft("draft-1");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/draft-1");
    expect(req.mock.calls[0][0].method).toBe("DELETE");
  });

  it("deleteMessage throws AuthError on 401", async () => {
    const req = vi.fn(async () => resp({}, 401));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await expect(p.deleteMessage("m1")).rejects.toMatchObject({ name: "AuthError" });
  });

  it("archiveMessage retries once on 429 then succeeds", async () => {
    let calls = 0;
    const req = vi.fn(async () => (++calls === 1 ? resp({}, 429, { "retry-after": "0" }) : resp({}, 200)));
    const p = new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });
    await p.archiveMessage("m1");
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/providers/ms-graph/graph-provider.test.ts`

- [ ] **Step 3: Implement in `src/providers/ms-graph/graph-provider.ts`**

Add these two methods (after `deleteDraft`):
```ts
  async deleteMessage(id: string): Promise<void> {
    await this.request<void>(`/me/messages/${id}`, "DELETE");
  }

  async archiveMessage(id: string): Promise<void> {
    await this.request<void>(`/me/messages/${id}/move`, "POST", { destinationId: "archive" });
  }
```

Then replace the existing `deleteDraft` body to delegate to `deleteMessage` (same Graph call, avoid duplication):
```ts
  async deleteDraft(id: string): Promise<void> {
    await this.deleteMessage(id);
  }
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/providers/ms-graph/graph-provider.test.ts`

- [ ] **Step 5: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: both clean — the Task 1 typecheck gap (GraphProvider not satisfying MailProvider) closes here, and no existing test regresses from the `deleteDraft` refactor (same URL/method, so its own pre-existing tests should be unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/providers/ms-graph/graph-provider.ts tests/providers/ms-graph/graph-provider.test.ts
git commit -m "feat: implement delete/archive methods on GraphProvider

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `ViewModel` delete/archive actions

**Files:**
- Modify: `src/view/view-model.ts`
- Test: `tests/view/view-model.test.ts`

**Interfaces:**
- Consumes: `MailProvider.deleteMessage`/`archiveMessage` (Tasks 1-2); existing `cache.deleteMessages`, `cache.getThreadMessages`, `reloadList`, `closeThread`, `errorMessage`.
- Produces: `deleteMessage(messageId)`, `archiveMessage(messageId)`, `deleteThread(threadId)`, `archiveThread(threadId)` — Task 4 (ThreadRow/MessageList) and Task 5 (MessageBlock/ReadingPane) call these via App.svelte's wiring in Task 6.

- [ ] **Step 1: Write the failing tests**

Add to `tests/view/view-model.test.ts` (reuse the file's existing `build()`/`sum()` helpers):
```ts
describe("ViewModel — delete/archive", () => {
  it("deleteMessage removes the message from the list and closes an open thread showing it", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    await ctx.vm.openThread("t1");
    expect(ctx.vm.getState().openThreadId).toBe("t1");

    await ctx.vm.deleteMessage("m1");

    expect(ctx.vm.getState().threads).toEqual([]);
    expect(ctx.vm.getState().openThreadId).toBeNull();
  });

  it("archiveMessage removes the message from the current list without closing an unrelated open thread", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1), sum("m2", "t2", 2)]);
    await ctx.vm.init();
    await ctx.vm.openThread("t2");

    await ctx.vm.archiveMessage("m1");

    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2"]);
    expect(ctx.vm.getState().openThreadId).toBe("t2");
  });

  it("deleteMessage sets a notice on provider failure and leaves the list unchanged", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1)]);
    await ctx.vm.init();
    vi.spyOn(ctx.provider, "deleteMessage").mockRejectedValue(new Error("network down"));

    await ctx.vm.deleteMessage("m1");

    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
    expect(ctx.vm.getState().notice).toContain("network down");
  });

  it("deleteThread deletes every message in the conversation, concurrently, and closes the thread if open", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1), sum("m2", "t1", 2), sum("m3", "t2", 3)]);
    await ctx.vm.init();
    await ctx.vm.openThread("t1");
    const spy = vi.spyOn(ctx.provider, "deleteMessage");

    await ctx.vm.deleteThread("t1");

    expect(spy).toHaveBeenCalledWith("m1");
    expect(spy).toHaveBeenCalledWith("m2");
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2"]);
    expect(ctx.vm.getState().openThreadId).toBeNull();
  });

  it("archiveThread reports partial failure without discarding what succeeded", async () => {
    const ctx = await build();
    await ctx.cache.putMailboxes("a1", await ctx.provider.listMailboxes());
    await ctx.cache.upsertMessages("a1", [sum("m1", "t1", 1), sum("m2", "t1", 2)]);
    await ctx.vm.init();
    vi.spyOn(ctx.provider, "archiveMessage").mockImplementation(async (id: string) => {
      if (id === "m2") throw new Error("boom");
    });

    await ctx.vm.archiveThread("t1");

    // m1 succeeded and was removed from cache; m2 failed and stays in INBOX,
    // so `groupThreads` still surfaces "t1" — just with only m2 left in it.
    // The thread does NOT fully disappear from the current mailbox's list,
    // and the partial failure is reported, not silently swallowed.
    expect(ctx.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
    expect(ctx.vm.getState().threads[0].messages.map((m) => m.id)).toEqual(["m2"]);
    expect(ctx.vm.getState().notice).toMatch(/1 of 2/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/view/view-model.test.ts`

- [ ] **Step 3: Implement in `src/view/view-model.ts`**

Add these methods to the `ViewModel` class (a good spot is right after `discardDraft` and before `openDraftForEdit`, keeping all the destructive/mutating provider-calling actions grouped together):

```ts
  private async actOnMessage(messageId: string, action: (provider: MailProvider) => Promise<void>): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) return;
    try {
      await action(provider);
      await this.deps.cache.deleteMessages(acct, [messageId]);
      if (this.state.openMessages.some((m) => m.summary.id === messageId)) this.closeThread();
      await this.reloadList();
    } catch (err) {
      this.set({ notice: this.errorMessage(err) });
    }
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.actOnMessage(messageId, (provider) => provider.deleteMessage(messageId));
  }

  async archiveMessage(messageId: string): Promise<void> {
    await this.actOnMessage(messageId, (provider) => provider.archiveMessage(messageId));
  }

  private async actOnThread(
    threadId: string,
    action: (provider: MailProvider, id: string) => Promise<void>,
    pastTense: "Deleted" | "Archived",
  ): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) return;
    const messages = await this.deps.cache.getThreadMessages(acct, threadId);
    const results = await Promise.allSettled(messages.map((m) => action(provider, m.id)));
    const succeededIds = messages.filter((_, i) => results[i].status === "fulfilled").map((m) => m.id);
    const failedCount = results.length - succeededIds.length;
    if (succeededIds.length) await this.deps.cache.deleteMessages(acct, succeededIds);
    if (this.state.openThreadId === threadId) this.closeThread();
    await this.reloadList();
    if (failedCount > 0) {
      this.set({
        notice: succeededIds.length === 0
          ? `Couldn't ${pastTense.toLowerCase()} this thread.`
          : `${pastTense} ${succeededIds.length} of ${messages.length} messages — ${failedCount} failed.`,
      });
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.actOnThread(threadId, (provider, id) => provider.deleteMessage(id), "Deleted");
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.actOnThread(threadId, (provider, id) => provider.archiveMessage(id), "Archived");
  }
```

`MailProvider` must be imported as a value-usable type in the private helper signatures — it's already imported as a type-only import at the top of the file (`import type { ... MailProvider ... } from "../providers/types";`), which is sufficient since it's only used in type position here (parameter types), not instantiated.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/view/view-model.test.ts`

- [ ] **Step 5: Typecheck and full suite**

Run: `npm run typecheck && npm test`

- [ ] **Step 6: Commit**

```bash
git add src/view/view-model.ts tests/view/view-model.test.ts
git commit -m "feat: add ViewModel delete/archive actions for messages and threads

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `ThreadRow.svelte` + `MessageList.svelte` — thread-level Archive/Delete

**Files:**
- Modify: `src/view/components/ThreadRow.svelte`
- Modify: `src/view/components/MessageList.svelte`
- Test: new `tests/view/thread-row.test.ts`; modify `tests/view/message-list.smoke.test.ts`

**Interfaces:**
- Consumes: nothing new from earlier tasks (these are pure UI components; App.svelte in Task 6 wires them to the ViewModel actions from Task 3).
- Produces: `ThreadRow` gains props `isDraftsMailbox: boolean`, `isArchiveMailbox: boolean`, `isTrashMailbox: boolean`, `onArchive: () => void`, `onDelete: () => void`. `MessageList` gains the same five plus threads them through per-row.

- [ ] **Step 1: Write the failing tests**

Create `tests/view/thread-row.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import ThreadRow from "../../src/view/components/ThreadRow.svelte";
import type { ThreadView } from "../../src/view/view-model";

const thread: ThreadView = {
  threadId: "t1", subject: "Hello", lastDate: Date.now(), unread: false,
  messages: [{
    id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
    to: [], cc: [], subject: "Hello", snippet: "hi", date: Date.now(),
    unread: false, hasAttachments: false, flagged: false,
  }],
};

function baseProps(over: Partial<Record<string, unknown>> = {}) {
  return {
    thread, isOpen: false, onOpen: vi.fn(),
    isDraftsMailbox: false, isArchiveMailbox: false, isTrashMailbox: false,
    onArchive: vi.fn(), onDelete: vi.fn(),
    ...over,
  };
}

describe("ThreadRow smoke", () => {
  it("shows Archive and Delete in a normal mailbox", () => {
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps() });
    flushSync();
    expect(host.querySelector('[data-action="archive"]')).not.toBeNull();
    expect(host.querySelector('[data-action="delete"]')).not.toBeNull();
    unmount(app);
  });

  it("hides Archive in Drafts, Archive, and Trash but always shows Delete", () => {
    for (const flags of [
      { isDraftsMailbox: true }, { isArchiveMailbox: true }, { isTrashMailbox: true },
    ]) {
      const host = document.createElement("div");
      const app = mount(ThreadRow, { target: host, props: baseProps(flags) });
      flushSync();
      expect(host.querySelector('[data-action="archive"]')).toBeNull();
      expect(host.querySelector('[data-action="delete"]')).not.toBeNull();
      unmount(app);
    }
  });

  it("clicking Archive calls onArchive without triggering onOpen", () => {
    const onArchive = vi.fn();
    const onOpen = vi.fn();
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ onArchive, onOpen }) });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="archive"]')!.click();
    expect(onArchive).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    unmount(app);
  });

  it("clicking Delete calls onDelete without triggering onOpen", () => {
    const onDelete = vi.fn();
    const onOpen = vi.fn();
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ onDelete, onOpen }) });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="delete"]')!.click();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    unmount(app);
  });

  it("clicking the row itself still calls onOpen", () => {
    const onOpen = vi.fn();
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ onOpen }) });
    flushSync();
    host.querySelector<HTMLElement>(".oe-thread-row")!.click();
    expect(onOpen).toHaveBeenCalledOnce();
    unmount(app);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement in `src/view/components/ThreadRow.svelte`**

Replace the file's props/template. The row's outer element changes from a `<button>` (which cannot legally contain nested `<button>` action elements) to a `<div role="button">`, following the exact same accessible-clickable-div pattern already used for `MessageBlock.svelte`'s header (`onclick`, `role="button"`, `tabindex="0"`, `onkeydown` for Enter):

```svelte
<script lang="ts">
  import type { ThreadView } from "../view-model";

  let { thread, isOpen, onOpen, isDraftsMailbox, isArchiveMailbox, isTrashMailbox, onArchive, onDelete }: {
    thread: ThreadView; isOpen: boolean; onOpen: () => void;
    isDraftsMailbox: boolean; isArchiveMailbox: boolean; isTrashMailbox: boolean;
    onArchive: () => void; onDelete: () => void;
  } = $props();

  const newest = $derived(thread.messages[thread.messages.length - 1]);
  const sender = $derived(newest.from.name || newest.from.email || "(unknown)");
  const hasAttachments = $derived(thread.messages.some((m) => m.hasAttachments));
  const showArchive = $derived(!isDraftsMailbox && !isArchiveMailbox && !isTrashMailbox);

  function relative(ts: number): string {
    const diff = Date.now() - ts;
    const min = 60_000, hr = 3_600_000, day = 86_400_000;
    if (diff < hr) return `${Math.max(1, Math.round(diff / min))}m`;
    if (diff < day) return `${Math.round(diff / hr)}h`;
    if (diff < 7 * day) return `${Math.round(diff / day)}d`;
    return new Date(ts).toLocaleDateString();
  }
</script>

<div
  class="oe-thread-row"
  class:is-unread={thread.unread}
  class:is-open={isOpen}
  onclick={onOpen}
  role="button"
  tabindex="0"
  onkeydown={(e) => (e.key === "Enter" ? onOpen() : null)}
>
  <div class="oe-thread-line1">
    <span class="oe-thread-sender">{sender}</span>
    <span class="oe-thread-date">{relative(thread.lastDate)}</span>
  </div>
  <div class="oe-thread-line2">
    {#if thread.unread}<span class="oe-dot" aria-label="unread">●</span>{/if}
    <span class="oe-thread-subject">{thread.subject}</span>
    {#if thread.messages.length > 1}<span class="oe-thread-count">{thread.messages.length}</span>{/if}
    {#if hasAttachments}<span class="oe-clip" aria-label="has attachments">📎</span>{/if}
  </div>
  <div class="oe-thread-snippet">{newest.snippet}</div>
  <div class="oe-thread-actions">
    {#if showArchive}
      <button type="button" data-action="archive" onclick={(e) => { e.stopPropagation(); onArchive(); }}>Archive</button>
    {/if}
    <button type="button" data-action="delete" onclick={(e) => { e.stopPropagation(); onDelete(); }}>Delete</button>
  </div>
</div>
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/view/thread-row.test.ts`

- [ ] **Step 5: Modify `src/view/components/MessageList.svelte`**

Extend its props and the `<ThreadRow>` invocation:
```ts
  let { threads, openThreadId, hasMore, loading, onOpen, onLoadMore, isDraftsMailbox, isArchiveMailbox, isTrashMailbox, onArchiveThread, onDeleteThread }: {
    threads: ThreadView[];
    openThreadId: string | null;
    hasMore: boolean;
    loading: boolean;
    onOpen: (threadId: string) => void;
    onLoadMore: () => void;
    isDraftsMailbox: boolean;
    isArchiveMailbox: boolean;
    isTrashMailbox: boolean;
    onArchiveThread: (threadId: string) => void;
    onDeleteThread: (threadId: string) => void;
  } = $props();
```

Update the `<ThreadRow>` invocation inside the `{#each}`:
```svelte
    <ThreadRow
      thread={t}
      isOpen={t.threadId === openThreadId}
      onOpen={() => onOpen(t.threadId)}
      {isDraftsMailbox}
      {isArchiveMailbox}
      {isTrashMailbox}
      onArchive={() => onArchiveThread(t.threadId)}
      onDelete={() => onDeleteThread(t.threadId)}
    />
```

- [ ] **Step 6: Add a smoke test for the passthrough**

Add to `tests/view/message-list.smoke.test.ts` (check the existing file's fixture conventions first and match them — it already mounts `MessageList` with a `threads` array):
```ts
it("threads mailbox-kind flags and archive/delete callbacks down to each ThreadRow", () => {
  const onArchiveThread = vi.fn();
  const onDeleteThread = vi.fn();
  const host = document.createElement("div");
  const app = mount(MessageList, {
    target: host,
    props: {
      threads: [{
        threadId: "t1", subject: "Hi", lastDate: 1, unread: false,
        messages: [{ id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { email: "a@x.com" }, to: [], cc: [],
          subject: "Hi", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: false }],
      }],
      openThreadId: null, hasMore: false, loading: false, onOpen: vi.fn(), onLoadMore: vi.fn(),
      isDraftsMailbox: false, isArchiveMailbox: false, isTrashMailbox: false,
      onArchiveThread, onDeleteThread,
    },
  });
  flushSync();
  host.querySelector<HTMLElement>('[data-action="archive"]')!.click();
  expect(onArchiveThread).toHaveBeenCalledWith("t1");
  host.querySelector<HTMLElement>('[data-action="delete"]')!.click();
  expect(onDeleteThread).toHaveBeenCalledWith("t1");
  unmount(app);
});
```

(Import `vi` and `flushSync`/`mount`/`unmount` from the same places the rest of the file already imports them from — check the file's existing imports before adding this test and reuse them rather than re-importing.)

- [ ] **Step 7: Run — expect PASS**

Run: `npx vitest run tests/view/message-list.smoke.test.ts tests/view/thread-row.test.ts`

- [ ] **Step 8: Add CSS for `.oe-thread-actions`**

In `styles.css`, extend the existing `.oe-message-actions` rules to also cover the new class (comma-joined, identical visual treatment — no new design):
```css
.oe-message-actions, .oe-thread-actions { display: flex; gap: 6px; padding: 0 10px 8px; }
.oe-message-actions button, .oe-thread-actions button { height: auto; background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 3px 8px; font-size: 12px; color: var(--text-muted); cursor: pointer; }
.oe-message-actions button:hover, .oe-thread-actions button:hover { color: var(--text-normal); }
```
Replace the existing three single-class `.oe-message-actions...` rules with these three comma-joined versions (find them near the other `.oe-message-actions` rules already in the file) rather than adding new, separate rules — avoid duplicating the same declarations twice under two different selectors.

- [ ] **Step 9: Run the full suite**

Run: `npm run typecheck && npm test`

- [ ] **Step 10: Commit**

```bash
git add src/view/components/ThreadRow.svelte src/view/components/MessageList.svelte tests/view/thread-row.test.ts tests/view/message-list.smoke.test.ts styles.css
git commit -m "feat: add thread-level Archive/Delete actions to ThreadRow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `MessageBlock.svelte` + `ReadingPane.svelte` — message-level Archive/Delete

**Files:**
- Modify: `src/view/components/MessageBlock.svelte`
- Modify: `src/view/components/ReadingPane.svelte`
- Test: `tests/view/reading-pane.smoke.test.ts`

**Interfaces:**
- Consumes: nothing new from earlier tasks (pure UI; App.svelte wires the callbacks in Task 6).
- Produces: `MessageBlock` gains props `isTrashMailbox: boolean`, `isArchiveMailbox: boolean`, `onArchive: () => void`, `onDelete: () => void`, and its existing reply/forward-vs-edit branching becomes a three-way branch. `ReadingPane` threads these plus `onArchiveMessage`/`onDeleteMessage` through per message.

- [ ] **Step 1: Write the failing tests**

Add to `tests/view/reading-pane.smoke.test.ts`, inside (or alongside) the existing `describe("ReadingPane — reply/forward/edit actions", ...)` block — reuse its existing `composerProps` const and `open()` fixture:
```ts
describe("ReadingPane — archive/delete actions", () => {
  const baseProps = (over: Partial<Record<string, unknown>> = {}) => ({
    openMessages: open(), autoLoadImages: false, renderDeps, onClose: () => {}, onDownload: vi.fn(),
    isDraftsMailbox: false, isArchiveMailbox: false, isTrashMailbox: false,
    activeComposerMessageId: null, composerMode: null, composerProps: null,
    onOpenReply: vi.fn(), onOpenForward: vi.fn(), onEditDraft: vi.fn(),
    onArchiveMessage: vi.fn(), onDeleteMessage: vi.fn(),
    ...over,
  });

  it("shows Archive and Delete on a message in a normal mailbox", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, { target: host, props: baseProps() });
    flushSync();
    expect(host.querySelector('[data-action="archive"]')).not.toBeNull();
    expect(host.querySelector('[data-action="delete"]')).not.toBeNull();
    unmount(app);
  });

  it("hides Reply/Reply-all/Forward and Archive in the Trash mailbox, but keeps Delete", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, { target: host, props: baseProps({ isTrashMailbox: true }) });
    flushSync();
    expect(host.querySelector('[data-action="reply"]')).toBeNull();
    expect(host.querySelector('[data-action="archive"]')).toBeNull();
    expect(host.querySelector('[data-action="delete"]')).not.toBeNull();
    unmount(app);
  });

  it("hides Archive (but not Delete) in the Archive mailbox, keeping Reply/Reply-all/Forward", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, { target: host, props: baseProps({ isArchiveMailbox: true }) });
    flushSync();
    expect(host.querySelector('[data-action="reply"]')).not.toBeNull();
    expect(host.querySelector('[data-action="archive"]')).toBeNull();
    expect(host.querySelector('[data-action="delete"]')).not.toBeNull();
    unmount(app);
  });

  it("in Drafts, shows Edit and Delete but not Archive", () => {
    const host = document.createElement("div");
    const app = mount(ReadingPane, { target: host, props: baseProps({ isDraftsMailbox: true }) });
    flushSync();
    expect(host.querySelector('[data-action="edit-draft"]')).not.toBeNull();
    expect(host.querySelector('[data-action="archive"]')).toBeNull();
    expect(host.querySelector('[data-action="delete"]')).not.toBeNull();
    unmount(app);
  });

  it("clicking Archive calls onArchiveMessage(m1)", () => {
    const onArchiveMessage = vi.fn();
    const host = document.createElement("div");
    const app = mount(ReadingPane, { target: host, props: baseProps({ onArchiveMessage }) });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="archive"]')!.click();
    expect(onArchiveMessage).toHaveBeenCalledWith("m1");
    unmount(app);
  });

  it("clicking Delete calls onDeleteMessage(m1)", () => {
    const onDeleteMessage = vi.fn();
    const host = document.createElement("div");
    const app = mount(ReadingPane, { target: host, props: baseProps({ onDeleteMessage }) });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="delete"]')!.click();
    expect(onDeleteMessage).toHaveBeenCalledWith("m1");
    unmount(app);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Modify `src/view/components/MessageBlock.svelte`**

Add to the props destructure and type (join the existing list):
```ts
    isTrashMailbox: boolean;
    isArchiveMailbox: boolean;
    onArchive: () => void;
    onDelete: () => void;
```

Replace the existing two-way `{#if isDraftsMailbox}...{:else}...{/if}` actions block with a three-way branch:
```svelte
    {#if isDraftsMailbox}
      <div class="oe-message-actions">
        <button type="button" data-action="edit-draft" onclick={onEditDraft}>Edit</button>
        <button type="button" data-action="delete" onclick={onDelete}>Delete</button>
      </div>
    {:else if isTrashMailbox}
      <div class="oe-message-actions">
        <button type="button" data-action="delete" onclick={onDelete}>Delete</button>
      </div>
    {:else}
      <div class="oe-message-actions">
        <button type="button" data-action="reply" onclick={() => onOpenReply("reply")}>Reply</button>
        <button type="button" data-action="reply-all" onclick={() => onOpenReply("replyAll")}>Reply all</button>
        <button type="button" data-action="forward" onclick={onOpenForward}>Forward</button>
        {#if !isArchiveMailbox}
          <button type="button" data-action="archive" onclick={onArchive}>Archive</button>
        {/if}
        <button type="button" data-action="delete" onclick={onDelete}>Delete</button>
      </div>
    {/if}
```

- [ ] **Step 4: Modify `src/view/components/ReadingPane.svelte`**

Add to its props destructure and type:
```ts
    isArchiveMailbox: boolean;
    isTrashMailbox: boolean;
    onArchiveMessage: (messageId: string) => void;
    onDeleteMessage: (messageId: string) => void;
```

Update the `<MessageBlock>` invocation inside the `{#each}` to add:
```svelte
        {isArchiveMailbox}
        {isTrashMailbox}
        onArchive={() => onArchiveMessage(m.summary.id)}
        onDelete={() => onDeleteMessage(m.summary.id)}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run tests/view/reading-pane.smoke.test.ts`

- [ ] **Step 6: Typecheck note**

Run: `npm run typecheck` — as established in SP2 (Task 9's review independently confirmed this), plain `tsc -noEmit` does not parse `.svelte` files in this project's config, so this will not surface any Svelte-level prop mismatches. This is a pre-existing, known toolchain characteristic (documented, not a regression to chase down in this task) — confirm the command still exits clean for the `.ts` files it does check, and move on.

- [ ] **Step 7: Run the full suite**

Run: `npm test`

- [ ] **Step 8: Commit**

```bash
git add src/view/components/MessageBlock.svelte src/view/components/ReadingPane.svelte tests/view/reading-pane.smoke.test.ts
git commit -m "feat: add message-level Archive/Delete actions to MessageBlock

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `App.svelte` — wiring, mailbox-kind derivations, and the permanent-delete confirm prompt

**Files:**
- Modify: `src/view/App.svelte`
- Test: `tests/view/app.smoke.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3-5.
- Produces: the fully wired delete/archive feature.

- [ ] **Step 1: Write the failing tests**

First, extend the `fakeVm()` fixture in `tests/view/app.smoke.test.ts` to add the four new methods as bare `vi.fn()`s (matching the existing convention — join the line that already has `send: vi.fn(), saveDraft: vi.fn(), discardDraft: vi.fn(), closeComposer: vi.fn(),`):
```ts
    deleteMessage: vi.fn(), archiveMessage: vi.fn(), deleteThread: vi.fn(), archiveThread: vi.fn(),
```

Then add a new `describe` block:
```ts
describe("App.svelte — delete/archive wiring", () => {
  it("clicking Archive on a thread row calls vm.archiveThread", () => {
    const archiveThread = vi.fn();
    const vm = fakeVm();
    Object.assign(vm, { archiveThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="archive"]')!.click();
    expect(archiveThread).toHaveBeenCalledWith("t1");
    unmount(app);
  });

  it("clicking Delete on a thread row in a normal mailbox calls vm.deleteThread immediately, no prompt", () => {
    const deleteThread = vi.fn();
    const vm = fakeVm();
    Object.assign(vm, { deleteThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="delete"]')!.click();
    expect(deleteThread).toHaveBeenCalledWith("t1");
    expect(host.querySelector(".oe-delete-confirm")).toBeNull();
    unmount(app);
  });

  it("clicking Delete on a thread row in the Trash mailbox shows a confirm prompt instead of deleting immediately", () => {
    const deleteThread = vi.fn();
    const vm = fakeVm({ mailboxes: [{ id: "TRASH", name: "Deleted Items", kind: "trash" }], activeMailboxId: "TRASH" });
    Object.assign(vm, { deleteThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="delete"]')!.click();
    flushSync();
    expect(deleteThread).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-delete-confirm")).not.toBeNull();

    host.querySelector<HTMLElement>(".oe-delete-confirm")!.click();
    expect(deleteThread).toHaveBeenCalledWith("t1");
    unmount(app);
  });

  it("canceling the delete-confirm prompt does not call vm.deleteThread", () => {
    const deleteThread = vi.fn();
    const vm = fakeVm({ mailboxes: [{ id: "TRASH", name: "Deleted Items", kind: "trash" }], activeMailboxId: "TRASH" });
    Object.assign(vm, { deleteThread });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    host.querySelector<HTMLElement>('[data-action="delete"]')!.click();
    flushSync();
    host.querySelector<HTMLElement>(".oe-delete-cancel")!.click();
    flushSync();
    expect(deleteThread).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-delete-confirm")).toBeNull();
    unmount(app);
  });

  it("passes isArchiveMailbox/isTrashMailbox derived from the active mailbox's kind down to MessageList", () => {
    const vm = fakeVm({ mailboxes: [{ id: "ARCHIVE", name: "Archive", kind: "archive" }], activeMailboxId: "ARCHIVE" });
    const host = document.createElement("div");
    const app = mount(App, { target: host, props: { vm, onAddAccount: () => {} } });
    flushSync();
    // Archive mailbox: the thread row's own Archive button should be hidden.
    expect(host.querySelector('[data-action="archive"]')).toBeNull();
    expect(host.querySelector('[data-action="delete"]')).not.toBeNull();
    unmount(app);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement in `src/view/App.svelte`**

Add a new derivation near the existing `isDraftsMailbox`:
```ts
  const isArchiveMailbox = $derived(
    state.mailboxes.find((m) => m.id === state.activeMailboxId)?.kind === "archive",
  );
  const isTrashMailbox = $derived(
    state.mailboxes.find((m) => m.id === state.activeMailboxId)?.kind === "trash",
  );
```

Add the delete-confirm prompt state and handlers, near the existing `pendingSwitch`/`requestSwitch`:
```ts
  let pendingDelete = $state<{ label: string; run: () => void } | null>(null);

  // Delete is the only action that's ever irreversible (permanently deleting
  // from Trash — see MailProvider.deleteMessage's doc comment). Everywhere
  // else it's recoverable (Graph moves the message to Deleted Items), so it
  // fires immediately with no prompt.
  function requestDelete(label: string, run: () => void): void {
    if (isTrashMailbox) pendingDelete = { label, run };
    else run();
  }
  function confirmDelete(): void {
    const p = pendingDelete;
    pendingDelete = null;
    p?.run();
  }
  function cancelDelete(): void {
    pendingDelete = null;
  }
```

Update the `<MessageList>` invocation to add:
```svelte
      {isDraftsMailbox}
      {isArchiveMailbox}
      {isTrashMailbox}
      onArchiveThread={(id) => vm.archiveThread(id)}
      onDeleteThread={(id) => requestDelete("thread", () => vm.deleteThread(id))}
```

Update the `<ReadingPane>` invocation to add:
```svelte
      {isArchiveMailbox}
      {isTrashMailbox}
      onArchiveMessage={(id) => vm.archiveMessage(id)}
      onDeleteMessage={(id) => requestDelete("message", () => vm.deleteMessage(id))}
```

Change the existing single `{#if pendingSwitch}...{/if}` prompt block at the end of the template into a two-way `{#if pendingSwitch}...{:else if pendingDelete}...{/if}` (mutually exclusive, defensively — these two prompts should never need to show at once, but the template should guarantee it rather than assume it):
```svelte
  {#if pendingSwitch}
    <div class="oe-composer-prompt">
      <p>You have an unsent message. Save it as a draft before switching?</p>
      {#if state.composer?.mode === "new" || state.composer?.mode === "editDraft"}
        <button type="button" class="oe-composer-prompt-save" onclick={resolvePromptSave}>Save draft</button>
      {/if}
      <button type="button" class="oe-composer-prompt-discard" onclick={resolvePromptDiscard}>Discard</button>
      <button type="button" class="oe-composer-prompt-cancel" onclick={resolvePromptCancel}>Cancel</button>
    </div>
  {:else if pendingDelete}
    <div class="oe-composer-prompt">
      <p>Permanently delete this {pendingDelete.label}? This can't be undone.</p>
      <button type="button" class="oe-delete-confirm" onclick={confirmDelete}>Delete</button>
      <button type="button" class="oe-delete-cancel" onclick={cancelDelete}>Cancel</button>
    </div>
  {/if}
```

No new CSS is needed for this prompt — it reuses the `.oe-composer-prompt` class (banner styling) and the existing generic `.oe-composer-prompt button` rule (button styling) already in `styles.css` from SP2, which style by descendant selector rather than by the buttons' own specific class names.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/view/app.smoke.test.ts`

- [ ] **Step 5: Typecheck and full suite**

Run: `npm run typecheck && npm test && npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/view/App.svelte tests/view/app.smoke.test.ts
git commit -m "feat: wire delete/archive actions into App.svelte with a permanent-delete confirm prompt

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Docs and manual verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- None — documentation and a manual pass in the dev vault.

- [ ] **Step 1: Update `README.md`**

Verified current structure: the file's sections run `## What it is`, `## Install`, `## Microsoft 365 setup`, `## Composing mail`, `## Security notes`, `## Development`, `## Roadmap` (in that order), and the current Roadmap section reads exactly:
```markdown
## Roadmap

- **SP3** — mail actions (archive, delete, mark read/unread, move, flag) and a
  unified inbox across accounts.
- **SP4** — polish: keyboard navigation, notifications, performance, settings UX.
```

Insert a new section immediately after `## Composing mail` and before `## Security notes`:
```markdown
## Deleting and archiving mail

- **Archive** and **Delete** buttons appear on each thread in the message
  list and on each expanded message in the reading pane.
- Deleting moves a message to your Deleted Items folder — it's recoverable
  from there (or from Outlook Web) like normal. Deleting **from** Deleted
  Items itself is permanent, and asks for confirmation first.
- Archive is hidden while you're in Drafts, Archive, or Deleted Items
  (nothing to archive there); Delete is always available.
- Reply, reply-all, and forward are hidden in Deleted Items — restore a
  message to another folder first if you need to act on it.
```

Replace the Roadmap section's SP3 line (archive/delete have now shipped; the still-outstanding items from that line move into the label) with:
```markdown
- **SP3** — mark read/unread, flag, move to custom folders, bulk selection, and a unified inbox across accounts.
```
Leave the existing `**SP4** — polish...` line exactly as it is — this reuses the SP3 label for what's left of its original scope rather than introducing a second, colliding SP4 line.

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm test && npm run build`
Expected: clean.

```bash
cp main.js manifest.json styles.css /Users/mfilbin/obsidian-dev-vault/.obsidian/plugins/obsidian-email/
```

- [ ] **Step 3: Manual dev-vault checklist**

This step requires a live Obsidian instance and a real Microsoft 365 account — it is NOT something an automated implementer can do, and must be performed by the user themselves. Reload Obsidian and verify by hand:
1. In the Inbox, click **Archive** on a thread; confirm it disappears from the Inbox list and (after a refresh or a moment) shows up in the Archive mailbox.
2. In the Inbox, click **Delete** on a thread; confirm it fires immediately (no prompt), disappears from Inbox, and shows up in Deleted Items.
3. Open the Deleted Items mailbox (click "Load more" once if it initially shows empty — this mailbox isn't background-synced, only loaded on demand). Click **Delete** on a message there; confirm the permanent-delete prompt appears, and clicking Delete removes it for good (check it's gone from Outlook Web's Deleted Items too, not just the local view).
4. Confirm Reply/Reply-all/Forward are hidden on messages inside Deleted Items, and Archive is hidden on messages already inside the Archive mailbox.
5. Expand a multi-message thread in the reading pane and use the message-level Archive/Delete buttons on one message within it; confirm only that message moves, not the whole thread.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document delete/archive support

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §1 both delete+archive, Graph-native soft/permanent semantics, Trash-permanent-with-confirm, one-at-a-time, whole-conversation thread actions | Tasks 1, 2, 3, 6 |
| §2 provider abstraction (`deleteMessage`/`archiveMessage`, exact Graph call shapes) | Tasks 1, 2 |
| §3 ViewModel actions (single + thread-level, concurrent with partial-failure reporting, cache cleanup, close-open-thread) | Task 3 |
| §4 `isTrashMailbox` confirm prompt, reusing SP2's prompt styling | Task 6 |
| §5 button-visibility table for both `ThreadRow` and `MessageBlock` | Tasks 4, 5 |
| §6 testing strategy (provider/ViewModel/component tests) | Tasks 1-6 each carry their own tests per this strategy |
| §7 out of scope (bulk select, restore, mark read/flag, custom folders) | Not built anywhere in this plan |

**Placeholder scan:** no "TBD"/"implement later"/prose-instead-of-code found on this pass. (An earlier draft of Task 3's partial-failure test had a wrong assertion explained via prose rather than corrected inline — fixed directly in the test code itself before finalizing this plan.)

**Type consistency:** `deleteMessage`/`archiveMessage`/`deleteThread`/`archiveThread` names and signatures are introduced once (Task 1 for the provider pair, Task 3 for the ViewModel quartet) and referenced identically in every later task's dispatch context. `isArchiveMailbox`/`isTrashMailbox` boolean names are consistent from their App.svelte derivation (Task 6) through `MessageList`/`ReadingPane` (Tasks 4-5) down to `ThreadRow`/`MessageBlock`. `onArchiveThread`/`onDeleteThread` (thread-level) and `onArchiveMessage`/`onDeleteMessage` (message-level) are named distinctly and consistently to avoid confusion between the two granularities across every file that touches them.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-11-delete-and-archive.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
