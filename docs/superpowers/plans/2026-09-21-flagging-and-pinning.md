# Flagging and Pinning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag messages for follow-up (synced to Outlook), pin threads to the top of the list (local to the plugin), and browse everything flagged in a Flagged view.

**Architecture:** Flags are a server write (`PATCH /me/messages/{id}` `flag.flagStatus`) applied optimistically through the cache, with rollback. Pins live in plugin `data.json` keyed by conversation id and drive list ordering. Both survive cache pruning. A virtual Flagged view is a `flaggedActive` mode of the view-model that lists cached flagged messages and fetches the rest from Graph. Controls appear on thread rows, message headers, the ribbon and the right-click menu.

**Tech Stack:** TypeScript, Svelte 5 runes, idb (IndexedDB), vitest + jsdom + fake-indexeddb, Microsoft Graph v1.0.

**Spec:** `docs/superpowers/specs/2026-09-21-flagging-and-pinning-design.md`

## Global Constraints

- `.svelte` files and `src/view/view-model.ts` never import `"obsidian"`; host capabilities flow `main.ts → …` (only `main.ts` touches Obsidian's `Menu`).
- No new OAuth scope: flag writes use the existing `Mail.ReadWrite`.
- Flags are mail writes: a 401/403 stays `AuthError` (unlike contacts).
- Optimistic flag updates go through the cache **and** in-memory state (search results are not cache-derived); a failure rolls back and toasts; nothing is queued offline.
- Pins are keyed by `threadId` (Graph `conversationId`), stored in `data.json`; `schemaVersion` stays 1 and old files load with `pins: []`.
- Pruning never deletes a flagged message or a message of a pinned thread.
- Baseline build has zero Svelte warnings; keep it (`$state` for `bind:this`, no blanket a11y disables).
- `tests/` is outside tsconfig scope; single file: `npx vitest run <path>`; full: `npm test`; types: `npm run typecheck`.
- Commit after each task; messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Do NOT bump the version in this plan; the release (`npm run release minor` → 0.6.0) happens at finish when the user asks.

## Rulings (plan-level decisions where the spec left latitude)

1. **Flags on `MailProvider`, tested with unit tests, not the shared mail contract.** The Graph adapter's contract run uses a hand-rolled HTTP simulator that models list/delta only; extending it to flags adds no value over direct request-shape tests. `FakeProvider` gets its own flag tests.
2. **`listFlaggedMessages` also selects `parentFolderId`** and maps it to `mailboxIds`. Search maps results with folder id `""` (fine for display) but flagged results are upserted into the cache, so they need real folder ids.
3. **`selectFlagged()` clears search and the composer, like `selectMailbox` does.** It does *not* clear the open thread (the spec's wording said it did; `selectMailbox` doesn't, and the view should behave the same for both).
4. **`ViewState.pinnedThreadIds: string[]`** (the active account's pins) lets the ribbon and rows know pin state without reading settings from components.
5. **Search results show the pin indicator but are not reordered** (`groupThreads(…, { floatPinned: false })`).
6. **Thread-row context-menu handler takes an actions object** instead of growing positional arguments.
7. **Staging is inside one PR:** flagging (Tasks 1–5, which also lays the pin storage/pruning infrastructure in Task 3) → pinning (Tasks 6–7) → Flagged view (Tasks 8–9) → final verification (Task 10).

## File Structure

| File | Responsibility |
| --- | --- |
| `src/providers/types.ts` | `MailProvider.setMessageFlag`, `listFlaggedMessages` |
| `src/providers/ms-graph/graph-mappers.ts`, `graph-provider.ts` | Graph flag PATCH + flagged listing |
| `src/providers/fake-provider.ts` | in-memory flag + flagged listing |
| `src/cache/mail-cache.ts` | `listFlaggedMessages`, retention keeps flagged/pinned |
| `src/settings/settings-store.ts` | `pins`, `pin/unpin/isPinned/pinnedThreadIds` |
| `src/sync/sync-engine.ts`, `src/plugin-context.ts` | pass pinned thread ids to pruning |
| `src/view/view-model.ts` | `ThreadView.flagged/pinned`, flag + pin toggles, `flaggedActive` view |
| `src/view/components/{ThreadRow,MessageList,MessageBlock,ReadingPane,MailboxList}.svelte` | indicators, buttons, Flagged entry |
| `src/view/ribbon/registry.ts` | Home › Mark group (Flag, Pin) |
| `src/view/App.svelte`, `src/view/mail-view.ts`, `src/main.ts` | wiring, context menu |
| `styles.css` | indicator/accent styles |

---

### Task 1: Provider — set flag, list flagged

**Files:**
- Modify: `src/providers/types.ts`, `src/providers/ms-graph/graph-mappers.ts`, `src/providers/ms-graph/graph-provider.ts`, `src/providers/fake-provider.ts`
- Test: `tests/providers/ms-graph/graph-provider.test.ts`, `tests/providers/fake-provider.test.ts`

**Interfaces:**
- Produces: `MailProvider.setMessageFlag(id: string, flagged: boolean): Promise<void>`; `MailProvider.listFlaggedMessages(pageToken?: string): Promise<Page<MessageSummary>>` (items carry real `mailboxIds`); `GraphMessage.parentFolderId?: string`.

- [ ] **Step 1: Write failing Graph tests**

Append to `tests/providers/ms-graph/graph-provider.test.ts` (it already imports `vi`, `GraphProvider`, `AuthError`; the `resp` helper is at the top of the file):

```ts
describe("GraphProvider flags", () => {
  const make = (req: ReturnType<typeof vi.fn>) =>
    new GraphProvider({ http: { request: req }, getAccessToken: async () => "at" });

  it("setMessageFlag PATCHes the follow-up flag on the message", async () => {
    const req = vi.fn(async () => resp({}));
    const p = make(req);
    await p.setMessageFlag("M1", true);
    await p.setMessageFlag("M1", false);
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/M1");
    expect(req.mock.calls[0][0].method).toBe("PATCH");
    expect(JSON.parse(req.mock.calls[0][0].body)).toEqual({ flag: { flagStatus: "flagged" } });
    expect(JSON.parse(req.mock.calls[1][0].body)).toEqual({ flag: { flagStatus: "notFlagged" } });
  });

  it("a 403 on setMessageFlag is an AuthError (mail semantics, not contacts)", async () => {
    const req = vi.fn(async () => resp({}, 403));
    await expect(make(req).setMessageFlag("M1", true)).rejects.toBeInstanceOf(AuthError);
  });

  it("listFlaggedMessages filters server-side, selects parentFolderId, and maps real mailbox ids", async () => {
    const req = vi.fn(async () => resp({
      value: [{
        id: "F1", conversationId: "c1", subject: "Follow up", parentFolderId: "AAAArchive",
        receivedDateTime: "2026-01-01T00:00:00Z", isRead: true, flag: { flagStatus: "flagged" },
      }],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=P2",
    }));
    const page = await make(req).listFlaggedMessages();
    const url: string = req.mock.calls[0][0].url;
    expect(url).toContain("/me/messages?$filter=flag/flagStatus%20eq%20'flagged'");
    expect(url).toContain("parentFolderId");
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: "F1", threadId: "c1", mailboxIds: ["AAAArchive"], flagged: true });
    expect(page.nextPageToken).toBe("https://graph.microsoft.com/v1.0/me/messages?$skiptoken=P2");
  });

  it("listFlaggedMessages follows a page token URL verbatim", async () => {
    const req = vi.fn(async () => resp({ value: [] }));
    await make(req).listFlaggedMessages("https://graph.microsoft.com/v1.0/me/messages?$skiptoken=P2");
    expect(req.mock.calls[0][0].url).toBe("https://graph.microsoft.com/v1.0/me/messages?$skiptoken=P2");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/providers/ms-graph/graph-provider.test.ts -t "GraphProvider flags"`
Expected: FAIL (`setMessageFlag is not a function`).

- [ ] **Step 3: Implement the interface and Graph provider**

In `src/providers/types.ts`, add to `MailProvider` (after `moveMessage`):

```ts
  /** Sets or clears the follow-up flag on one message. Only flagged /
   *  not-flagged are modelled: Outlook's "completed" state reads as not
   *  flagged, and clearing writes `notFlagged`. */
  setMessageFlag(id: string, flagged: boolean): Promise<void>;

  /** Every flagged message across folders (the caller excludes Trash/Junk).
   *  Unlike `search`, items carry their real `mailboxIds` so they can be
   *  cached. Paged; pass the previous page's `nextPageToken`. */
  listFlaggedMessages(pageToken?: string): Promise<Page<MessageSummary>>;
```

In `src/providers/ms-graph/graph-mappers.ts` add `parentFolderId?: string;` to the `GraphMessage` interface (next to `conversationId`).

In `src/providers/ms-graph/graph-provider.ts` add after `SUMMARY_SELECT`:

```ts
// Flagged results are upserted into the cache, so unlike search they need the
// message's real folder id.
const FLAGGED_SELECT = `${SUMMARY_SELECT},parentFolderId`;
```

and the methods (next to `moveMessage`):

```ts
  async setMessageFlag(id: string, flagged: boolean): Promise<void> {
    await this.request<void>(`/me/messages/${id}`, "PATCH", {
      flag: { flagStatus: flagged ? "flagged" : "notFlagged" },
    });
  }

  async listFlaggedMessages(pageToken?: string): Promise<Page<MessageSummary>> {
    const url = pageToken
      ? pageToken
      : `/me/messages?$filter=flag/flagStatus%20eq%20'flagged'&$select=${FLAGGED_SELECT}&$top=${TOP}`;
    const data = await this.get<{ value?: GraphMessage[]; "@odata.nextLink"?: string }>(url);
    return {
      items: (data.value ?? []).map((m) => mapGraphSummary(m, m.parentFolderId ?? "")),
      nextPageToken: data["@odata.nextLink"],
    };
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/providers/ms-graph/graph-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing FakeProvider tests**

Append to `tests/providers/fake-provider.test.ts` (imports `FakeProvider`, `describe/it/expect` already exist; add `MessageSummary` to the `../../src/providers/types` type import if it isn't there):

```ts
describe("FakeProvider flags", () => {
  const msg = (id: string, date: number, flagged = false): MessageSummary => ({
    id, threadId: id, mailboxIds: ["INBOX"], from: { email: "s@x.com" }, to: [], cc: [],
    subject: id, snippet: "", date, unread: false, hasAttachments: false, flagged,
  });

  it("setMessageFlag flips the flag and syncSince reports it as an upsert", async () => {
    const p = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    p.addMessage(msg("m1", 1));
    const cursor = await p.initialCursor();
    await p.setMessageFlag("m1", true);
    const result = await p.syncSince(cursor);
    expect(result.upserts.find((u) => u.id === "m1")).toMatchObject({ flagged: true });
    await p.setMessageFlag("m1", false);
    expect((await p.listFlaggedMessages()).items).toEqual([]);
  });

  it("setMessageFlag rejects for an unknown message", async () => {
    await expect(new FakeProvider().setMessageFlag("nope", true)).rejects.toThrow(/no such message/);
  });

  it("listFlaggedMessages returns only flagged messages, newest first, paged", async () => {
    const p = new FakeProvider();
    p.pageSize = 2;
    p.addMessage(msg("a", 1, true));
    p.addMessage(msg("b", 2, false));
    p.addMessage(msg("c", 3, true));
    p.addMessage(msg("d", 4, true));
    const first = await p.listFlaggedMessages();
    expect(first.items.map((m) => m.id)).toEqual(["d", "c"]);
    const second = await p.listFlaggedMessages(first.nextPageToken);
    expect(second.items.map((m) => m.id)).toEqual(["a"]);
    expect(second.nextPageToken).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run tests/providers/fake-provider.test.ts -t "FakeProvider flags"`
Expected: FAIL.

- [ ] **Step 7: Implement in `FakeProvider`**

In `src/providers/fake-provider.ts`, add next to `moveMessage`:

```ts
  async setMessageFlag(id: string, flagged: boolean): Promise<void> {
    const m = this.messages.get(id);
    if (!m) throw new Error(`no such message: ${id}`);
    // Logged as an upsert so `syncSince` reports the change like Graph's delta does.
    this.addMessage({ ...m, flagged });
  }

  async listFlaggedMessages(pageToken?: string): Promise<Page<MessageSummary>> {
    const all = [...this.messages.values()].filter((m) => m.flagged).sort((a, b) => b.date - a.date);
    const start = pageToken ? Number(pageToken) : 0;
    const items = all.slice(start, start + this.pageSize);
    const next = start + this.pageSize;
    return { items, nextPageToken: next < all.length ? String(next) : undefined };
  }
```

- [ ] **Step 8: Run to verify pass + typecheck + full suite**

Run: `npx vitest run tests/providers && npm run typecheck && npm test`
Expected: PASS. (If any other test double implements `MailProvider` structurally and now fails typecheck, add no-op `setMessageFlag`/`listFlaggedMessages` to it.)

- [ ] **Step 9: Commit**

```bash
git add src/providers tests/providers
git commit -m "feat: provider support for setting flags and listing flagged messages" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Cache — flagged scan and retention

**Files:**
- Modify: `src/cache/mail-cache.ts`
- Test: `tests/cache/mail-cache.test.ts`

**Interfaces:**
- Produces: `MailCache.listFlaggedMessages(accountId): Promise<MessageSummary[]>` (flagged, excluding messages that live only in Trash/Junk, newest first); `MailCache.pruneAccount(accountId, now?, opts?: { keepThreadIds?: Iterable<string> })` — summary pruning never deletes a flagged message or a message whose `threadId` is in `keepThreadIds`.

- [ ] **Step 1: Write failing tests**

Append inside `describe("MailCache", …)` in `tests/cache/mail-cache.test.ts` (uses the file's `msg()` helper and `cache`):

```ts
  describe("flagged messages", () => {
    it("listFlaggedMessages returns flagged messages newest-first, across mailboxes", async () => {
      await cache.putMailboxes("a1", [
        { id: "INBOX", name: "Inbox", kind: "inbox" },
        { id: "ARCH", name: "Archive", kind: "archive" },
      ]);
      await cache.upsertMessages("a1", [
        msg("m1", { flagged: true, date: 1 }),
        msg("m2", { flagged: false, date: 5 }),
        msg("m3", { flagged: true, date: 3, mailboxIds: ["ARCH"] }),
      ]);
      expect((await cache.listFlaggedMessages("a1")).map((m) => m.id)).toEqual(["m3", "m1"]);
    });

    it("excludes flagged messages that live only in Trash or Junk, and other accounts'", async () => {
      await cache.putMailboxes("a1", [
        { id: "INBOX", name: "Inbox", kind: "inbox" },
        { id: "TRASH", name: "Deleted Items", kind: "trash" },
        { id: "JUNK", name: "Junk", kind: "spam" },
      ]);
      await cache.upsertMessages("a1", [
        msg("keep", { flagged: true }),
        msg("trashed", { flagged: true, mailboxIds: ["TRASH"] }),
        msg("junked", { flagged: true, mailboxIds: ["JUNK"] }),
      ]);
      await cache.upsertMessages("a2", [msg("other", { flagged: true })]);
      expect((await cache.listFlaggedMessages("a1")).map((m) => m.id)).toEqual(["keep"]);
    });

    it("strips storage fields from the returned summaries", async () => {
      await cache.putMailboxes("a1", [{ id: "INBOX", name: "Inbox", kind: "inbox" }]);
      await cache.upsertMessages("a1", [msg("m1", { flagged: true })]);
      const [s] = await cache.listFlaggedMessages("a1");
      expect("key" in s).toBe(false);
      expect("accountId" in s).toBe(false);
    });
  });

  describe("retention keeps flagged and pinned", () => {
    const DAY = 24 * 3600 * 1000;
    const seedOverCap = async () => {
      const now = Date.now();
      const old = now - 100 * DAY;
      const many = Array.from({ length: 2001 }, (_, i) => msg(`m${i}`, { date: i < 5 ? old : now }));
      // m0 flagged, m1 in a kept thread, m2..m4 are ordinary old messages
      many[0] = msg("m0", { date: old, flagged: true });
      many[1] = msg("m1", { date: old, threadId: "keep-thread" });
      await cache.upsertMessages("a1", many);
      return now;
    };

    it("never prunes a flagged message, even when old and over the cap", async () => {
      const now = await seedOverCap();
      await cache.pruneAccount("a1", now);
      const list = await cache.listMailboxMessages("a1", "INBOX", { limit: 5000 });
      expect(list.find((m) => m.id === "m0")).toBeDefined();
      expect(list.find((m) => m.id === "m2")).toBeUndefined();
    });

    it("never prunes messages of a kept (pinned) thread", async () => {
      const now = await seedOverCap();
      await cache.pruneAccount("a1", now, { keepThreadIds: ["keep-thread"] });
      const list = await cache.listMailboxMessages("a1", "INBOX", { limit: 5000 });
      expect(list.find((m) => m.id === "m1")).toBeDefined();
      expect(list.find((m) => m.id === "m3")).toBeUndefined();
    });

    it("without keepThreadIds an old unflagged message is still pruned", async () => {
      const now = await seedOverCap();
      await cache.pruneAccount("a1", now);
      const list = await cache.listMailboxMessages("a1", "INBOX", { limit: 5000 });
      expect(list.find((m) => m.id === "m1")).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/cache/mail-cache.test.ts -t "flagged|retention keeps"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/cache/mail-cache.ts` add (near `listMailboxMessages`):

```ts
  /** Flagged messages across every mailbox, newest first — the Flagged view's
   *  cached half. A message that lives only in Trash/Junk is hidden (it is
   *  effectively deleted), matching what Outlook's own flagged list shows. */
  async listFlaggedMessages(accountId: string): Promise<MessageSummary[]> {
    const [rows, boxes] = await Promise.all([
      this.db.getAllFromIndex("messages", "by-account", accountId),
      this.getMailboxes(accountId),
    ]);
    const hidden = new Set(boxes.filter((b) => b.kind === "trash" || b.kind === "spam").map((b) => b.id));
    return rows
      .filter((r) => r.flagged && r.mailboxIds.some((id) => !hidden.has(id)))
      .sort((a, b) => b.date - a.date)
      .map(({ key: _k, accountId: _a, ...summary }) => summary);
  }
```

Replace `pruneAccount` and `pruneSummaries`:

```ts
  /** `keepThreadIds` (the user's pinned conversations) and flagged messages
   *  are exempt from summary pruning: a pinned thread or a flagged follow-up
   *  must not silently age out of the cache. */
  async pruneAccount(
    accountId: string,
    now: number = Date.now(),
    opts: { keepThreadIds?: Iterable<string> } = {},
  ): Promise<void> {
    await this.pruneSummaries(accountId, now, new Set(opts.keepThreadIds ?? []));
    await this.pruneBodies(accountId, now);
  }

  private async pruneSummaries(accountId: string, now: number, keepThreadIds: ReadonlySet<string>): Promise<void> {
    const rows = await this.db.getAllFromIndex("messages", "by-account", accountId);
    const perMailbox = new Map<string, number>();
    for (const r of rows) for (const mb of r.mailboxIds) perMailbox.set(mb, (perMailbox.get(mb) ?? 0) + 1);
    const overCap = [...perMailbox.values()].some((c) => c > RETENTION.summaryPerMailbox);
    if (!overCap) return;
    const cutoff = now - RETENTION.summaryDays * DAY_MS;
    const tx = this.db.transaction("messages", "readwrite");
    await Promise.all(
      rows
        .filter((r) => r.date < cutoff && !r.flagged && !keepThreadIds.has(r.threadId))
        .map((r) => tx.store.delete(r.key)),
    );
    await tx.done;
  }
```

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `npx vitest run tests/cache && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cache/mail-cache.ts tests/cache/mail-cache.test.ts
git commit -m "feat: cache flagged-message scan; retention keeps flagged and pinned threads" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Pins in settings, and pruning wiring

**Files:**
- Modify: `src/settings/settings-store.ts`, `src/sync/sync-engine.ts`, `src/plugin-context.ts`
- Test: `tests/settings/settings-store.test.ts`, `tests/sync/sync-engine.test.ts`

**Interfaces:**
- Produces: `PluginSettings.pins: Array<{ accountId: string; threadId: string; pinnedAt: number }>`; `SettingsStore.pinnedThreadIds(accountId): Set<string>`, `isPinned(accountId, threadId): boolean`, `pin(accountId, threadId): Promise<void>` and `unpin(accountId, threadId): Promise<void>` (idempotent; if persisting fails the in-memory change is reverted and the error rethrown); `SyncEngineDeps.getPinnedThreadIds?: (accountId: string) => Iterable<string>`.

- [ ] **Step 1: Write failing settings tests**

Append to `tests/settings/settings-store.test.ts` inside the `describe("SettingsStore", …)` (uses the file's `host()` and `acct()` helpers):

```ts
  describe("pins", () => {
    it("loads an old data file with no pins as an empty list", async () => {
      const s = await SettingsStore.load(host({ schemaVersion: 1, accounts: [], prefs: {} }));
      expect(s.get().pins).toEqual([]);
      expect(s.pinnedThreadIds("a1").size).toBe(0);
    });

    it("pin / unpin are idempotent, scoped per account, and persisted", async () => {
      const h = host();
      const s = await SettingsStore.load(h);
      await s.pin("a1", "t1");
      await s.pin("a1", "t1");
      await s.pin("a2", "t1");
      expect(s.isPinned("a1", "t1")).toBe(true);
      expect([...s.pinnedThreadIds("a1")]).toEqual(["t1"]);
      expect((h.saved() as { pins: unknown[] }).pins).toHaveLength(2);
      await s.unpin("a1", "t1");
      await s.unpin("a1", "t1");
      expect(s.isPinned("a1", "t1")).toBe(false);
      expect(s.isPinned("a2", "t1")).toBe(true);
    });

    it("records when a thread was pinned", async () => {
      const s = await SettingsStore.load(host());
      const before = Date.now();
      await s.pin("a1", "t1");
      expect(s.get().pins[0].pinnedAt).toBeGreaterThanOrEqual(before);
    });

    it("removing an account drops its pins", async () => {
      const s = await SettingsStore.load(host());
      await s.addAccount(acct("a1"));
      await s.pin("a1", "t1");
      await s.pin("a2", "t9");
      await s.removeAccount("a1");
      expect(s.isPinned("a1", "t1")).toBe(false);
      expect(s.isPinned("a2", "t9")).toBe(true);
    });

    it("reverts the in-memory change and rethrows when persisting fails", async () => {
      let fail = false;
      const s = await SettingsStore.load({
        loadData: async () => null,
        saveData: async () => { if (fail) throw new Error("disk full"); },
      });
      await s.pin("a1", "t1");
      fail = true;
      await expect(s.pin("a1", "t2")).rejects.toThrow("disk full");
      expect(s.isPinned("a1", "t2")).toBe(false);
      await expect(s.unpin("a1", "t1")).rejects.toThrow("disk full");
      expect(s.isPinned("a1", "t1")).toBe(true);
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/settings/settings-store.test.ts -t pins`
Expected: FAIL.

- [ ] **Step 3: Implement pins in `SettingsStore`**

In `src/settings/settings-store.ts`:

```ts
export interface PinnedThread {
  accountId: string;
  /** Graph `conversationId` — stable when the thread is moved or archived. */
  threadId: string;
  pinnedAt: number;
}
```

Add `pins: PinnedThread[];` to `PluginSettings`, `pins: []` to `DEFAULT_SETTINGS`, and to `migrate`'s return: `pins: Array.isArray(obj.pins) ? obj.pins : [],`.

In `removeAccount`, add `this.settings.pins = this.settings.pins.filter((p) => p.accountId !== id);` before `persist()`.

Add the methods:

```ts
  isPinned(accountId: string, threadId: string): boolean {
    return this.settings.pins.some((p) => p.accountId === accountId && p.threadId === threadId);
  }

  pinnedThreadIds(accountId: string): Set<string> {
    return new Set(this.settings.pins.filter((p) => p.accountId === accountId).map((p) => p.threadId));
  }

  async pin(accountId: string, threadId: string): Promise<void> {
    if (this.isPinned(accountId, threadId)) return;
    await this.mutatePins((pins) => [...pins, { accountId, threadId, pinnedAt: Date.now() }]);
  }

  async unpin(accountId: string, threadId: string): Promise<void> {
    if (!this.isPinned(accountId, threadId)) return;
    await this.mutatePins((pins) => pins.filter((p) => !(p.accountId === accountId && p.threadId === threadId)));
  }

  /** Applies `change`, persists, and puts the previous pins back if persisting
   *  fails — so the UI never shows a pin that isn't actually saved. */
  private async mutatePins(change: (pins: PinnedThread[]) => PinnedThread[]): Promise<void> {
    const previous = this.settings.pins;
    this.settings.pins = change(previous);
    try {
      await this.persist();
    } catch (err) {
      this.settings.pins = previous;
      throw err;
    }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/settings`
Expected: PASS (existing tests that `toEqual(DEFAULT_SETTINGS)` still hold because `pins: []` is part of the defaults).

- [ ] **Step 5: Write failing sync-engine test**

Append to `tests/sync/sync-engine.test.ts` (inside its top-level `describe`; it has `harness`, `summary`, `FakeProvider`, `MailCache`):

```ts
  it("passes the pinned thread ids to pruning so pinned threads survive", async () => {
    const provider = new FakeProvider({ mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }] });
    provider.addMessage(summary("m1", 1));
    const name = dbName();
    const cache = await MailCache.open(name);
    const cursors = await CursorStore.open(name);
    const prune = vi.spyOn(cache, "pruneAccount");
    const engine = new SyncEngine({
      cache, cursors, logger,
      getProvider: () => provider,
      listAccountIds: () => ["a1"],
      getPinnedThreadIds: (id) => (id === "a1" ? ["t-pinned"] : []),
    });
    await engine.syncAccount("a1"); // backfill
    await engine.syncAccount("a1"); // incremental
    expect(prune).toHaveBeenCalledTimes(2);
    for (const call of prune.mock.calls) {
      expect(call[0]).toBe("a1");
      expect([...(call[2]?.keepThreadIds ?? [])]).toEqual(["t-pinned"]);
    }
  });
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run tests/sync/sync-engine.test.ts -t "pinned thread ids"`
Expected: FAIL (`keepThreadIds` undefined).

- [ ] **Step 7: Implement the wiring**

In `src/sync/sync-engine.ts`: add to `SyncEngineDeps`

```ts
  /** The account's pinned conversation ids — exempt from cache pruning. */
  getPinnedThreadIds?: (accountId: string) => Iterable<string>;
```

and replace both `await this.deps.cache.pruneAccount(accountId, this.now());` lines (in `backfill` and `incremental`) with:

```ts
    await this.deps.cache.pruneAccount(accountId, this.now(), {
      keepThreadIds: this.deps.getPinnedThreadIds?.(accountId) ?? [],
    });
```

In `src/plugin-context.ts`, add to the `new SyncEngine({ … })` argument: `getPinnedThreadIds: (id) => settings.pinnedThreadIds(id),`.

- [ ] **Step 8: Run to verify pass + typecheck + full suite**

Run: `npx vitest run tests/settings tests/sync && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/settings src/sync src/plugin-context.ts tests/settings tests/sync
git commit -m "feat: local pins in settings; pruning keeps pinned threads" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: View-model — flag toggles

**Files:**
- Modify: `src/view/view-model.ts`
- Test: `tests/view/view-model.test.ts`

**Interfaces:**
- Consumes: Task 1 (`provider.setMessageFlag`), Task 2/existing (`cache.patchMessages`, `cache.getThreadMessages`).
- Produces: `ThreadView.flagged: boolean` (any message flagged); `ViewModel.toggleThreadFlag(threadId): Promise<void>`; `ViewModel.toggleMessageFlag(messageId): Promise<void>` (the message must be among `openMessages`, which is the only place a per-message toggle exists).

- [ ] **Step 1: Write failing tests**

Add a new `describe` inside the top-level `describe("ViewModel", …)` in `tests/view/view-model.test.ts` (uses the file's `build()` and `sum()`):

```ts
  describe("flagging", () => {
    type Ctx = Awaited<ReturnType<typeof build>>;
    async function seed(c: Ctx, msgs: Array<[string, string, number]>) {
      await c.cache.putMailboxes("a1", await c.provider.listMailboxes());
      await c.cache.upsertMessages("a1", msgs.map(([id, t, d]) => sum(id, t, d)));
      for (const [id, t, d] of msgs) c.provider.addMessage(sum(id, t, d));
      await c.vm.init();
    }
    const flaggedInCache = async (c: Ctx, thread: string) =>
      (await c.cache.getThreadMessages("a1", thread)).map((m) => m.flagged);

    it("a thread row is flagged when any of its messages is", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t1", 2]]);
      expect(c.vm.getState().threads[0].flagged).toBe(false);
      await c.cache.patchMessages("a1", [{ id: "m1", mailboxIds: ["INBOX"], flagged: true }]);
      await c.vm.selectMailbox("INBOX");
      expect(c.vm.getState().threads[0].flagged).toBe(true);
    });

    it("toggleMessageFlag flags optimistically — before the server answers — then confirms", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.vm.openThread("t1");
      let release!: () => void;
      const spy = vi.spyOn(c.provider, "setMessageFlag").mockImplementation(
        () => new Promise<void>((res) => { release = res; }),
      );
      const pending = c.vm.toggleMessageFlag("m1");
      await vi.waitFor(() => expect(c.vm.getState().openMessages[0].summary.flagged).toBe(true));
      expect(c.vm.getState().threads[0].flagged).toBe(true);
      expect(await flaggedInCache(c, "t1")).toEqual([true]);
      expect(spy).toHaveBeenCalledWith("m1", true);
      release();
      await pending;
      expect(c.vm.getState().openMessages[0].summary.flagged).toBe(true);
      expect(c.showNotice).not.toHaveBeenCalled();
    });

    it("toggleMessageFlag clears an already-flagged message", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.provider.setMessageFlag("m1", true);
      await c.cache.patchMessages("a1", [{ id: "m1", mailboxIds: ["INBOX"], flagged: true }]);
      await c.vm.openThread("t1");
      const spy = vi.spyOn(c.provider, "setMessageFlag");
      await c.vm.toggleMessageFlag("m1");
      expect(spy).toHaveBeenCalledWith("m1", false);
      expect(c.vm.getState().openMessages[0].summary.flagged).toBe(false);
      expect(await flaggedInCache(c, "t1")).toEqual([false]);
    });

    it("rolls back the cache and the view and toasts when the server rejects", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.vm.openThread("t1");
      vi.spyOn(c.provider, "setMessageFlag").mockRejectedValue(new Error("boom"));
      await c.vm.toggleMessageFlag("m1");
      expect(c.vm.getState().openMessages[0].summary.flagged).toBe(false);
      expect(c.vm.getState().threads[0].flagged).toBe(false);
      expect(await flaggedInCache(c, "t1")).toEqual([false]);
      expect(c.showNotice).toHaveBeenCalledWith("boom");
    });

    it("toggleThreadFlag flags every message when some are unflagged (only the unflagged are sent)", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t1", 2]]);
      await c.cache.patchMessages("a1", [{ id: "m1", mailboxIds: ["INBOX"], flagged: true }]);
      await c.vm.selectMailbox("INBOX");
      const spy = vi.spyOn(c.provider, "setMessageFlag");
      await c.vm.toggleThreadFlag("t1");
      expect(spy.mock.calls).toEqual([["m2", true]]);
      expect(await flaggedInCache(c, "t1")).toEqual([true, true]);
      expect(c.vm.getState().threads[0].flagged).toBe(true);
    });

    it("toggleThreadFlag clears every message when they are all flagged", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t1", 2]]);
      await c.cache.patchMessages("a1", [
        { id: "m1", mailboxIds: ["INBOX"], flagged: true }, { id: "m2", mailboxIds: ["INBOX"], flagged: true },
      ]);
      await c.vm.selectMailbox("INBOX");
      const spy = vi.spyOn(c.provider, "setMessageFlag");
      await c.vm.toggleThreadFlag("t1");
      expect(spy.mock.calls.map((a) => a[1])).toEqual([false, false]);
      expect(await flaggedInCache(c, "t1")).toEqual([false, false]);
      expect(c.vm.getState().threads[0].flagged).toBe(false);
    });

    it("a partial thread failure rolls back only the failed messages and reports N of M", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t1", 2]]);
      vi.spyOn(c.provider, "setMessageFlag").mockImplementation(async (id: string) => {
        if (id === "m2") throw new Error("boom");
      });
      await c.vm.toggleThreadFlag("t1");
      expect(await flaggedInCache(c, "t1")).toEqual([true, false]);
      expect(c.showNotice).toHaveBeenCalledWith(expect.stringMatching(/1 of 2/));
    });

    it("a total thread failure rolls everything back and toasts the reason", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t1", 2]]);
      vi.spyOn(c.provider, "setMessageFlag").mockRejectedValue(new AuthError("expired"));
      await c.vm.toggleThreadFlag("t1");
      expect(await flaggedInCache(c, "t1")).toEqual([false, false]);
      expect(c.vm.getState().threads[0].flagged).toBe(false);
      expect(c.showNotice).toHaveBeenCalledWith(expect.stringMatching(/reauthentication/i));
    });

    it("updates a search-result row in place (search results aren't cache-derived)", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      c.provider.setSearchResults("q", [sum("m1", "t1", 1)]);
      await c.vm.runSearch("q");
      await c.vm.toggleThreadFlag("t1");
      expect(c.vm.getState().search.active).toBe(true);
      expect(c.vm.getState().threads[0].flagged).toBe(true);
    });

    it("toggleMessageFlag for a message that isn't open toasts instead of throwing", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.vm.toggleMessageFlag("nope");
      expect(c.showNotice).toHaveBeenCalledWith(expect.stringMatching(/couldn't find/i));
    });

    it("toggleThreadFlag for an unknown thread toasts instead of throwing", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.vm.toggleThreadFlag("nope");
      expect(c.showNotice).toHaveBeenCalledWith(expect.stringMatching(/couldn't find/i));
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/view-model.test.ts -t flagging`
Expected: FAIL (`toggleMessageFlag is not a function`).

- [ ] **Step 3: Implement**

In `src/view/view-model.ts`:

1. `ThreadView` gains `flagged: boolean;` (doc: `/** Any message in the thread is flagged. */`), and `groupThreads` sets `flagged: msgs.some((m) => m.flagged),` in the pushed object.

2. Add these methods next to `moveThread`:

```ts
  /** Flags every message in the thread, or clears them all if they are all
   *  flagged already — the same thread-level reach as Archive/Delete/Move. */
  async toggleThreadFlag(threadId: string): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) return;
    let messages: MessageSummary[];
    try {
      messages = await this.deps.cache.getThreadMessages(acct, threadId);
    } catch (err) {
      this.deps.showNotice(this.errorMessage(err));
      return;
    }
    if (messages.length === 0) {
      this.deps.showNotice("Couldn't find any messages in that thread.");
      return;
    }
    const flagged = !messages.every((m) => m.flagged);
    await this.setFlags(acct, provider, messages.filter((m) => m.flagged !== flagged), flagged);
  }

  /** Per-message toggle from the reading pane; the message must be open. */
  async toggleMessageFlag(messageId: string): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) return;
    const summary = this.state.openMessages.find((m) => m.summary.id === messageId)?.summary;
    if (!summary) {
      this.deps.showNotice("Couldn't find that message.");
      return;
    }
    await this.setFlags(acct, provider, [summary], !summary.flagged);
  }

  /** Optimistic: the cache and the visible rows change first, then the server
   *  is told; whatever the server rejects is written back. `messages` are all
   *  currently `!flagged`, so a rollback simply restores `!flagged`. */
  private async setFlags(
    acct: string,
    provider: MailProvider,
    messages: MessageSummary[],
    flagged: boolean,
  ): Promise<void> {
    if (messages.length === 0) return;
    const write = (value: boolean, list: MessageSummary[]) =>
      this.deps.cache.patchMessages(
        acct,
        list.map((m) => ({ id: m.id, mailboxIds: m.mailboxIds, flagged: value })),
      );
    try {
      await write(flagged, messages);
      this.applyFlagChange(acct, messages.map((m) => m.id), flagged);
      const results = await Promise.allSettled(messages.map((m) => provider.setMessageFlag(m.id, flagged)));
      const failed = messages.filter((_, i) => results[i].status === "rejected");
      if (failed.length === 0) return;
      await write(!flagged, failed);
      this.applyFlagChange(acct, failed.map((m) => m.id), !flagged);
      const firstError = (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
      this.deps.showNotice(
        failed.length === messages.length
          ? this.errorMessage(firstError)
          : `${flagged ? "Flagged" : "Unflagged"} ${messages.length - failed.length} of ${messages.length} messages — ${failed.length} failed.`,
      );
    } catch (err) {
      this.deps.showNotice(this.errorMessage(err));
    }
  }

  /** Mirrors a flag change into the rows already on screen (search results
   *  aren't derived from the cache, so they can't just be reloaded). */
  private applyFlagChange(acct: string, ids: string[], flagged: boolean): void {
    if (acct !== this.state.activeAccountId) return; // the user switched accounts mid-flight
    const hit = new Set(ids);
    const patch = (m: MessageSummary): MessageSummary => (hit.has(m.id) ? { ...m, flagged } : m);
    this.set({
      threads: this.state.threads.map((t) => {
        if (!t.messages.some((m) => hit.has(m.id))) return t;
        const messages = t.messages.map(patch);
        return { ...t, messages, flagged: messages.some((m) => m.flagged) };
      }),
      openMessages: this.state.openMessages.map((o) =>
        hit.has(o.summary.id) ? { ...o, summary: patch(o.summary) } : o,
      ),
    });
  }
```

- [ ] **Step 4: Run to verify pass + typecheck + full suite**

Run: `npx vitest run tests/view/view-model.test.ts && npm run typecheck && npm test`
Expected: PASS. (Tests elsewhere that construct `ThreadView` literals don't need `flagged` at runtime; they're outside tsconfig.)

- [ ] **Step 5: Commit**

```bash
git add src/view/view-model.ts tests/view/view-model.test.ts
git commit -m "feat: optimistic thread and message flag toggles with rollback" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Flag UI — row, message header, ribbon, context menu

**Files:**
- Modify: `src/view/action-icons.ts`, `src/view/components/ThreadRow.svelte`, `MessageList.svelte`, `MessageBlock.svelte`, `ReadingPane.svelte`, `src/view/ribbon/registry.ts`, `src/view/App.svelte`, `src/view/mail-view.ts`, `src/main.ts`, `styles.css`
- Test: `tests/view/thread-row.test.ts`, `message-list.smoke.test.ts`, `reading-pane.smoke.test.ts`, `ribbon-registry.test.ts`, `ribbon.smoke.test.ts`, `app.smoke.test.ts`

**Interfaces:**
- Consumes: Task 4 (`vm.toggleThreadFlag`, `vm.toggleMessageFlag`).
- Produces:
  - `ACTION_ICON.flag = "flag"`, `ACTION_ICON.unflag = "flag-off"`.
  - `ThreadRow` prop `onToggleFlag(): void`; DOM: `.oe-flag` indicator (when any message flagged), `[data-action="flag"]` button (`aria-pressed`, label Flag/Unflag).
  - `MessageList` prop `onToggleFlag(threadId: string): void`.
  - `MessageBlock` prop `onToggleFlag(): void`; DOM: `.oe-message-flag` button (`aria-pressed`, `.is-flagged`), which must not expand/collapse the message (click and keyboard).
  - `ReadingPane` optional prop `onToggleFlag?(messageId: string): void`.
  - Ribbon: `RibbonContext.openThreadFlagged: boolean`; `RibbonActions.toggleFlag(): void`; command `flag` (Home › "Mark", icon `flag`, enabled `hasOpenThread`, `pressed` = `openThreadFlagged`), added to the mail-only set.
  - `mail-view.ts`: `interface ThreadMenuActions { candidates: Mailbox[]; onMove(destinationMailboxId: string): void; flagged: boolean; onToggleFlag(): void }` and `type ThreadContextMenuHandler = (evt: MouseEvent, actions: ThreadMenuActions) => void`.

- [ ] **Step 1: Update shared test helpers, then write the failing tests**

In `tests/view/ribbon-registry.test.ts` AND `tests/view/ribbon.smoke.test.ts`: add `"toggleFlag"` to the `names` array in `actions()`, and `openThreadFlagged: false,` to the `ctx()` defaults. In `ribbon-registry.test.ts` update the Home-groups expectation to `["New", "Respond", "Manage", "Mark", "Sync", "Search", "View"]`, and change the existing "only … are toggle-style (pressed)" test so it compares a sorted list that includes `"flag"` (e.g. `expect(ids.sort()).toEqual(["contacts", "flag", "search"])`).

In `tests/view/app.smoke.test.ts` `fakeVm`: add `toggleThreadFlag: vi.fn(), toggleMessageFlag: vi.fn(),` to the returned object; and update every existing assertion that expects `onThreadContextMenu` to be called with the old positional `(evt, candidates, onMove)` form to the new `(evt, actions)` form (`actions.candidates`, `actions.onMove`).

Then add these tests.

`tests/view/thread-row.test.ts` (uses `thread`, `baseProps`):

```ts
describe("ThreadRow flagging", () => {
  const flaggedThread: ThreadView = {
    ...thread, flagged: true,
    messages: [{ ...thread.messages[0], flagged: true }],
  };

  it("shows a Flag button that reports the toggle without opening the thread", () => {
    const onToggleFlag = vi.fn(); const onOpen = vi.fn();
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ onToggleFlag, onOpen }) });
    flushSync();
    const btn = host.querySelector<HTMLButtonElement>('[data-action="flag"]')!;
    expect(btn.textContent).toContain("Flag");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    btn.click();
    expect(onToggleFlag).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-flag")).toBeNull();
    unmount(app);
  });

  it("a flagged thread shows the indicator and an Unflag button", () => {
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ thread: flaggedThread, onToggleFlag: vi.fn() }) });
    flushSync();
    expect(host.querySelector(".oe-flag")).not.toBeNull();
    const btn = host.querySelector<HTMLButtonElement>('[data-action="flag"]')!;
    expect(btn.textContent).toContain("Unflag");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    unmount(app);
  });

  it("the indicator shows when only one of several messages is flagged", () => {
    const two: ThreadView = {
      ...thread,
      messages: [thread.messages[0], { ...thread.messages[0], id: "m2", flagged: true }],
    };
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ thread: two }) });
    flushSync();
    expect(host.querySelector(".oe-flag")).not.toBeNull();
    unmount(app);
  });
});
```

`tests/view/message-list.smoke.test.ts`:

```ts
  it("passes the thread id to onToggleFlag", () => {
    const onToggleFlag = vi.fn();
    const host = document.createElement("div");
    const app = mount(MessageList, {
      target: host,
      props: { threads: [thread("t1")], openThreadId: null, hasMore: false, loading: false, onOpen: () => {}, onLoadMore: () => {}, onToggleFlag },
    });
    host.querySelector<HTMLElement>('[data-action="flag"]')!.click();
    expect(onToggleFlag).toHaveBeenCalledWith("t1");
    unmount(app);
  });
```

`tests/view/reading-pane.smoke.test.ts` (uses `open()`, `renderDeps`, `headFor`):

```ts
describe("ReadingPane message flag toggle", () => {
  const mountPane = (messages: ViewState["openMessages"], onToggleFlag = vi.fn()) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(ReadingPane, {
      target: host,
      props: { openMessages: messages, autoLoadImages: false, renderDeps, onClose: vi.fn(), onDownload: vi.fn(), onToggleFlag },
    });
    flushSync();
    return { host, onToggleFlag, done: () => { unmount(app); host.remove(); } };
  };

  it("each message header has a flag toggle that reports its id and reflects the state", () => {
    const msgs = open();
    msgs[0] = { ...msgs[0], summary: { ...msgs[0].summary, flagged: true } };
    const { host, onToggleFlag, done } = mountPane(msgs);
    const btn = host.querySelector<HTMLButtonElement>(".oe-message-flag")!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.classList.contains("is-flagged")).toBe(true);
    btn.click();
    expect(onToggleFlag).toHaveBeenCalledWith("m1");
    done();
  });

  it("toggling the flag does not expand or collapse the message (click or keyboard)", () => {
    const { host, done } = mountPane(open());
    const block = host.querySelector(".oe-message-block")!;
    const wasExpanded = block.classList.contains("is-expanded");
    const btn = host.querySelector<HTMLButtonElement>(".oe-message-flag")!;
    btn.click();
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    flushSync();
    expect(block.classList.contains("is-expanded")).toBe(wasExpanded);
    done();
  });
});
```

`tests/view/ribbon-registry.test.ts`:

```ts
describe("ribbon registry — flag", () => {
  it("Flag is a Home › Mark toggle: needs an open thread, pressed while flagged, mail-mode only", () => {
    expect(cmd("flag").tab).toBe("home");
    expect(cmd("flag").group).toBe("Mark");
    expect(enabled("flag", ctx({ hasOpenThread: false }))).toBe(false);
    expect(enabled("flag", ctx())).toBe(true);
    expect(enabled("flag", ctx({ mode: "contacts" }))).toBe(false);
    expect(cmd("flag").pressed?.(ctx({ openThreadFlagged: true }))).toBe(true);
    expect(cmd("flag").pressed?.(ctx())).toBe(false);
    const c = ctx();
    cmd("flag").run!(c);
    expect(c.actions.toggleFlag).toHaveBeenCalledOnce();
  });
});
```

`tests/view/app.smoke.test.ts` (uses `fakeVm`, `mountApp` from the contacts describe — copy the small helper or reuse the file's existing mount helper; `q`/`click` helpers as in that describe):

```ts
describe("App — flagging", () => {
  const openState = {
    openThreadId: "t1",
    openMessages: [{
      summary: {
        id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
        to: [], cc: [], subject: "Hello", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: true,
      },
    }],
  };
  const mountApp = (vm: ViewModel, over: object = {}) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(App, { target: host, props: appProps(vm, over) });
    flushSync();
    return { host, done: () => { unmount(app); host.remove(); } };
  };
  const click = (el: Element | null) => { (el as HTMLElement).click(); flushSync(); };

  it("the row Flag button toggles that thread", () => {
    const vm = fakeVm();
    const { host, done } = mountApp(vm);
    click(host.querySelector('.oe-thread-row [data-action="flag"]'));
    expect(vm.toggleThreadFlag).toHaveBeenCalledWith("t1");
    done();
  });

  it("the ribbon Flag button toggles the open thread and shows pressed when it has a flagged message", () => {
    const vm = fakeVm(openState);
    const { host, done } = mountApp(vm);
    const btn = host.querySelector<HTMLElement>('.oe-ribbon [data-action="flag"]')!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    click(btn);
    expect(vm.toggleThreadFlag).toHaveBeenCalledWith("t1");
    done();
  });

  it("a message header flag toggles that message", () => {
    const vm = fakeVm(openState);
    const { host, done } = mountApp(vm);
    click(host.querySelector(".oe-message-flag"));
    expect(vm.toggleMessageFlag).toHaveBeenCalledWith("m1");
    done();
  });

  it("the thread context menu receives flag state and a working toggle", () => {
    const onThreadContextMenu = vi.fn();
    const vm = fakeVm();
    const { host, done } = mountApp(vm, { onThreadContextMenu });
    host.querySelector(".oe-thread-row")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(onThreadContextMenu).toHaveBeenCalledOnce();
    const [, actions] = onThreadContextMenu.mock.calls[0];
    expect(actions.flagged).toBe(false);
    expect(Array.isArray(actions.candidates)).toBe(true);
    actions.onToggleFlag();
    expect(vm.toggleThreadFlag).toHaveBeenCalledWith("t1");
    done();
  });
});
```

If the ribbon button doesn't expose `aria-pressed` in this repo's `RibbonButton.svelte` (check it), assert the `is-pressed`/`pressed` class it does use, matching how the existing Search/Contacts pressed tests assert it.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/thread-row.test.ts tests/view/message-list.smoke.test.ts tests/view/reading-pane.smoke.test.ts tests/view/ribbon-registry.test.ts tests/view/app.smoke.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Icons**

In `src/view/action-icons.ts` add to `ACTION_ICON`: `flag: "flag", unflag: "flag-off",`.

- [ ] **Step 4: `ThreadRow.svelte`**

Add `onToggleFlag` to the props (type `onToggleFlag: () => void;`), the derived flag, the indicator, and the button:

```ts
  const flagged = $derived(thread.messages.some((m) => m.flagged));
```

In `oe-thread-line2`, after the attachments clip:

```svelte
    {#if flagged}<span class="oe-flag" role="img" aria-label="flagged" use:icon={ACTION_ICON.flag}></span>{/if}
```

In `oe-thread-actions`, before the Archive button:

```svelte
    <button type="button" data-action="flag" aria-pressed={flagged} onclick={(e) => { e.stopPropagation(); onToggleFlag(); }}>
      <span class="oe-action-icon" use:icon={flagged ? ACTION_ICON.unflag : ACTION_ICON.flag}></span>{flagged ? "Unflag" : "Flag"}
    </button>
```

- [ ] **Step 5: `MessageList.svelte`**

Add `onToggleFlag` to the props list/type (`onToggleFlag: (threadId: string) => void;`) and pass `onToggleFlag={() => onToggleFlag(t.threadId)}` to `<ThreadRow>`.

- [ ] **Step 6: `MessageBlock.svelte` and `ReadingPane.svelte`**

`MessageBlock`: add `import { ACTION_ICON } from "../action-icons"; import { icon } from "../icon-action";`, add prop `onToggleFlag: () => void;`, and inside the header, after the date span:

```svelte
    <button
      type="button" class="oe-message-flag" class:is-flagged={summary.flagged}
      aria-pressed={summary.flagged} aria-label={summary.flagged ? "Remove flag" : "Flag message"}
      use:icon={ACTION_ICON.flag}
      onclick={(e) => { e.stopPropagation(); onToggleFlag(); }}
      onkeydown={(e) => e.stopPropagation()}
    ></button>
```

(The header is itself `role="button"` with an Enter/Space handler; the nested button's `stopPropagation` on click and keydown keeps toggling the flag from also toggling expansion.)

`ReadingPane`: add optional prop `onToggleFlag?: (messageId: string) => void;` and pass `onToggleFlag={() => onToggleFlag?.(m.summary.id)}` to `<MessageBlock>`.

- [ ] **Step 7: Ribbon registry**

In `src/view/ribbon/registry.ts`: add `openThreadFlagged: boolean;` to `RibbonContext` (with a doc comment: an open message is flagged), `toggleFlag(): void;` to `RibbonActions`, add `"flag"` to the `MAIL_ONLY` set, and insert after the `close-pane` command in `BASE_COMMANDS`:

```ts
  { id: "flag", tab: "home", group: "Mark", icon: ACTION_ICON.flag, label: "Flag",
    enabled: (c) => c.hasOpenThread, pressed: (c) => c.openThreadFlagged, run: (c) => c.actions.toggleFlag() },
```

- [ ] **Step 8: Context menu types and `main.ts`**

In `src/view/mail-view.ts` replace the `ThreadContextMenuHandler` type with:

```ts
export interface ThreadMenuActions {
  /** Every mailbox except the active one — the Move destinations. */
  candidates: Mailbox[];
  onMove: (destinationMailboxId: string) => void;
  /** Any message in the thread is flagged. */
  flagged: boolean;
  onToggleFlag: () => void;
}

export type ThreadContextMenuHandler = (evt: MouseEvent, actions: ThreadMenuActions) => void;
```

In `src/main.ts` change the handler's signature and add the Flag item before Move (keep the existing explanatory comment block about the chained Move menu and the captured position):

```ts
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
          // … existing Move item, unchanged …
```

- [ ] **Step 9: `App.svelte`**

- Import the new type: extend the existing `import type { NoteCommands } from "./mail-view";` to `import type { NoteCommands, ThreadMenuActions } from "./mail-view";` and change the `onThreadContextMenu` prop's declared type to `(evt: MouseEvent, actions: ThreadMenuActions) => void` (update its doc comment).
- `<MessageList …>`: add `onToggleFlag={(id) => { void vm.toggleThreadFlag(id); }}` and change `onThreadContextMenu` to:

```svelte
        onThreadContextMenu={(evt, id) =>
          onThreadContextMenu(evt, {
            candidates: state.mailboxes.filter((m) => m.id !== state.activeMailboxId),
            onMove: (destinationId) => moveThread(id, destinationId),
            flagged: state.threads.find((t) => t.threadId === id)?.messages.some((m) => m.flagged) ?? false,
            onToggleFlag: () => { void vm.toggleThreadFlag(id); },
          })}
```

- `<ReadingPane …>`: add `onToggleFlag={(id) => { void vm.toggleMessageFlag(id); }}`.
- `ribbonCtx`: add `openThreadFlagged: state.openMessages.some((m) => m.summary.flagged),` and, in `actions`, `toggleFlag: () => { const id = state.openThreadId; if (id) void vm.toggleThreadFlag(id); },`. (Flagging never replaces a composer or a thread, so it does not go through `guarded`/`requestSwitch`.)

- [ ] **Step 10: Styles**

Append to `styles.css`:

```css
/* --- Flags --- */
.oe-flag { display: inline-flex; width: 14px; height: 14px; color: var(--color-red, #d64545); }
.oe-flag svg { width: 12px; height: 12px; fill: currentColor; }
.oe-message-flag { margin-left: 8px; height: auto; padding: 2px; background: transparent; border: none; color: var(--text-faint); cursor: pointer; display: inline-flex; }
.oe-message-flag svg { width: 14px; height: 14px; }
.oe-message-flag:hover { color: var(--text-muted); }
.oe-message-flag.is-flagged { color: var(--color-red, #d64545); }
.oe-message-flag.is-flagged svg { fill: currentColor; }
```

- [ ] **Step 11: Run to verify pass, typecheck, build, full suite**

Run: `npx vitest run tests/view && npm run typecheck && npm run build 2>&1 | tail -10 && npm test`
Expected: PASS; build has **no Svelte warnings** (the nested `<button>` inside the `role="button"` header must not warn; if it does, add the specific `<!-- svelte-ignore <code> -->` the compiler names directly above it).

- [ ] **Step 12: Commit**

```bash
git add src tests styles.css
git commit -m "feat: flag controls on thread rows, message headers, ribbon and context menu" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: View-model — pinning and ordering

**Files:**
- Modify: `src/view/view-model.ts`
- Test: `tests/view/view-model.test.ts`

**Interfaces:**
- Consumes: Task 3 (`settings.pinnedThreadIds/isPinned/pin/unpin`), Task 4's `ThreadView.flagged`.
- Produces: `ThreadView.pinned: boolean`; `ViewState.pinnedThreadIds: string[]` (the active account's pins); `ViewModel.toggleThreadPin(threadId): Promise<void>`; `groupThreads(messages, pinned?, { floatPinned? })` (module-private) — pinned threads sort first, newest activity first inside each group; search results pass `floatPinned: false` (indicator only, no reordering).

- [ ] **Step 1: Write failing tests**

Add a `describe` inside the top-level `describe("ViewModel", …)` in `tests/view/view-model.test.ts` (reuses `build()` / `sum()`):

```ts
  describe("pinning", () => {
    type Ctx = Awaited<ReturnType<typeof build>>;
    async function seed(c: Ctx, msgs: Array<[string, string, number]>) {
      await c.cache.putMailboxes("a1", await c.provider.listMailboxes());
      await c.cache.upsertMessages("a1", msgs.map(([id, t, d]) => sum(id, t, d)));
      for (const [id, t, d] of msgs) c.provider.addMessage(sum(id, t, d));
    }

    it("a pinned thread sorts first even when older, and is marked pinned", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t2", 2], ["m3", "t3", 3]]);
      await c.settings.pin("a1", "t1");
      await c.vm.init();
      const threads = c.vm.getState().threads;
      expect(threads.map((t) => t.threadId)).toEqual(["t1", "t3", "t2"]);
      expect(threads.map((t) => t.pinned)).toEqual([true, false, false]);
      expect(c.vm.getState().pinnedThreadIds).toEqual(["t1"]);
    });

    it("several pinned threads keep newest-activity order among themselves", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t2", 2], ["m3", "t3", 3]]);
      await c.settings.pin("a1", "t1");
      await c.settings.pin("a1", "t2");
      await c.vm.init();
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2", "t1", "t3"]);
    });

    it("toggleThreadPin pins and unpins, persists, and re-sorts the list", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t2", 2]]);
      await c.vm.init();
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2", "t1"]);
      await c.vm.toggleThreadPin("t1");
      expect(c.settings.isPinned("a1", "t1")).toBe(true);
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1", "t2"]);
      expect(c.vm.getState().pinnedThreadIds).toEqual(["t1"]);
      await c.vm.toggleThreadPin("t1");
      expect(c.settings.isPinned("a1", "t1")).toBe(false);
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2", "t1"]);
      expect(c.vm.getState().pinnedThreadIds).toEqual([]);
    });

    it("a pinned thread older than the loaded page still appears, at the top", async () => {
      const c = await build();
      const many: Array<[string, string, number]> = Array.from({ length: 205 }, (_, i) => [`n${i}`, `tn${i}`, 1000 + i]);
      await seed(c, [["old", "t-old", 1], ...many]);
      await c.settings.pin("a1", "t-old");
      await c.vm.init();
      const threads = c.vm.getState().threads;
      expect(threads[0].threadId).toBe("t-old");
      expect(threads).toHaveLength(201); // the 200 newest + the pinned extra
    });

    it("a pinned thread appears only in mailboxes that hold its messages", async () => {
      const c = await build();
      await c.cache.putMailboxes("a1", await c.provider.listMailboxes());
      await c.cache.upsertMessages("a1", [
        sum("m1", "t1", 5),
        { ...sum("m2", "t2", 1), mailboxIds: ["SENT"] },
      ]);
      await c.settings.pin("a1", "t2");
      await c.vm.init();
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
      await c.vm.selectMailbox("SENT");
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2"]);
    });

    it("search results show the pin but are not reordered", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1], ["m2", "t2", 2]]);
      await c.settings.pin("a1", "t1");
      await c.vm.init();
      c.provider.setSearchResults("q", [sum("m2", "t2", 2), sum("m1", "t1", 1)]);
      await c.vm.runSearch("q");
      const threads = c.vm.getState().threads;
      expect(threads.map((t) => t.threadId)).toEqual(["t2", "t1"]);
      expect(threads.find((t) => t.threadId === "t1")!.pinned).toBe(true);
    });

    it("toggling a pin while searching updates the pin mark in place", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.vm.init();
      c.provider.setSearchResults("q", [sum("m1", "t1", 1)]);
      await c.vm.runSearch("q");
      await c.vm.toggleThreadPin("t1");
      expect(c.vm.getState().search.active).toBe(true);
      expect(c.vm.getState().threads[0].pinned).toBe(true);
    });

    it("a failed save reverts the pin and toasts", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.vm.init();
      vi.spyOn(c.settings, "pin").mockRejectedValue(new Error("disk full"));
      await c.vm.toggleThreadPin("t1");
      expect(c.vm.getState().pinnedThreadIds).toEqual([]);
      expect(c.vm.getState().threads[0].pinned).toBe(false);
      expect(c.showNotice).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    });

    it("pins are per account: another account's pin doesn't mark this one's thread", async () => {
      const c = await build();
      await seed(c, [["m1", "t1", 1]]);
      await c.settings.pin("other-account", "t1");
      await c.vm.init();
      expect(c.vm.getState().threads[0].pinned).toBe(false);
      expect(c.vm.getState().pinnedThreadIds).toEqual([]);
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/view-model.test.ts -t pinning`
Expected: FAIL (`toggleThreadPin is not a function`, `pinned` undefined).

- [ ] **Step 3: Implement**

In `src/view/view-model.ts`:

1. `ThreadView` gains `/** The user pinned this conversation (local to the plugin). */ pinned: boolean;`; `ViewState` gains `/** The active account's pinned conversation ids. */ pinnedThreadIds: string[];` with initial value `pinnedThreadIds: []` in the `state` initializer.

2. Replace `groupThreads` with:

```ts
function groupThreads(
  messages: MessageSummary[],
  pinned: ReadonlySet<string> = new Set(),
  opts: { floatPinned?: boolean } = {},
): ThreadView[] {
  const byThread = new Map<string, MessageSummary[]>();
  for (const m of messages) {
    const arr = byThread.get(m.threadId) ?? [];
    arr.push(m);
    byThread.set(m.threadId, arr);
  }
  const threads: ThreadView[] = [];
  for (const [threadId, msgs] of byThread) {
    msgs.sort((a, b) => a.date - b.date);
    threads.push({
      threadId,
      subject: msgs[msgs.length - 1].subject,
      lastDate: Math.max(...msgs.map((m) => m.date)),
      messages: msgs,
      unread: msgs.some((m) => m.unread),
      flagged: msgs.some((m) => m.flagged),
      pinned: pinned.has(threadId),
    });
  }
  // Pinned threads float to the top (newest activity first within each group);
  // search results keep plain recency order and only show the pin mark.
  const float = opts.floatPinned ?? true;
  threads.sort((a, b) => (float ? Number(b.pinned) - Number(a.pinned) : 0) || b.lastDate - a.lastDate);
  return threads;
}
```

3. In `reloadList`, replace the block from `const rows = await …listMailboxMessages…` through the `this.set({ threads: groupThreads(rows), …` so it reads:

```ts
    const rows = await this.deps.cache.listMailboxMessages(acct, mb, { limit });
    // A pinned thread must show even if it is older than the loaded page:
    // fetch its messages that live in this mailbox and add them to the rows.
    const pinned = this.deps.settings.pinnedThreadIds(acct);
    const seen = new Set(rows.map((r) => r.threadId));
    const extra: MessageSummary[] = [];
    for (const threadId of pinned) {
      if (seen.has(threadId)) continue;
      const messages = await this.deps.cache.getThreadMessages(acct, threadId);
      extra.push(...messages.filter((m) => m.mailboxIds.includes(mb)));
    }
    if (seq !== this.reloadSeq) return;
    this.set({
      threads: groupThreads([...rows, ...extra], pinned),
      pinnedThreadIds: [...pinned],
```

(keep the existing `hasMore` and `loadingList: false` properties and comments unchanged after it).

4. In `runSearch`, change `threads: groupThreads(page.items),` to:

```ts
        threads: groupThreads(page.items, this.deps.settings.pinnedThreadIds(acct), { floatPinned: false }),
        pinnedThreadIds: [...this.deps.settings.pinnedThreadIds(acct)],
```

5. Add the toggle next to `toggleMessageFlag`:

```ts
  /** Pins or unpins the conversation (local to the plugin). A save failure
   *  leaves the pin as it was — SettingsStore reverts its own change. */
  async toggleThreadPin(threadId: string): Promise<void> {
    const acct = this.state.activeAccountId;
    if (!acct) return;
    const { settings } = this.deps;
    try {
      if (settings.isPinned(acct, threadId)) await settings.unpin(acct, threadId);
      else await settings.pin(acct, threadId);
    } catch (err) {
      this.deps.showNotice(`Couldn't save the pin: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const pinned = settings.pinnedThreadIds(acct);
    this.set({
      pinnedThreadIds: [...pinned],
      // Search results aren't re-derived from the cache — mark them in place.
      threads: this.state.threads.map((t) => ({ ...t, pinned: pinned.has(t.threadId) })),
    });
    // Re-sort (and pull in a pinned thread older than the page) from the cache.
    await this.reloadListUnlessSearching();
  }
```

6. In `selectAccount`, add `pinnedThreadIds: [...this.deps.settings.pinnedThreadIds(id)],` to the `this.set({ … })` that switches accounts.

- [ ] **Step 4: Run to verify pass + typecheck + full suite**

Run: `npx vitest run tests/view/view-model.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/view/view-model.ts tests/view/view-model.test.ts
git commit -m "feat: pinned threads sort first, survive paging, and toggle from the view-model" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Pin UI — row, ribbon, context menu

**Files:**
- Modify: `src/view/action-icons.ts`, `src/view/components/ThreadRow.svelte`, `MessageList.svelte`, `src/view/ribbon/registry.ts`, `src/view/App.svelte`, `src/view/mail-view.ts`, `src/main.ts`, `styles.css`
- Test: `tests/view/thread-row.test.ts`, `message-list.smoke.test.ts`, `ribbon-registry.test.ts`, `ribbon.smoke.test.ts`, `app.smoke.test.ts`

**Interfaces:**
- Consumes: Task 6 (`vm.toggleThreadPin`, `ThreadView.pinned`, `ViewState.pinnedThreadIds`).
- Produces:
  - `ACTION_ICON.pin = "pin"`, `ACTION_ICON.unpin = "pin-off"`.
  - `ThreadRow` prop `onTogglePin(): void`; DOM: `.oe-pin` indicator and `is-pinned` row class when `thread.pinned`; `[data-action="pin"]` button (`aria-pressed`, label Pin/Unpin).
  - `MessageList` prop `onTogglePin(threadId: string): void`.
  - Ribbon: `RibbonContext.openThreadPinned: boolean`; `RibbonActions.togglePin(): void`; command `pin` (Home › "Mark", icon `pin`, enabled `hasOpenThread`, `pressed` = `openThreadPinned`), in the mail-only set.
  - `ThreadMenuActions` gains `pinned: boolean; onTogglePin(): void`.

- [ ] **Step 1: Update helpers, then write failing tests**

In `tests/view/ribbon-registry.test.ts` and `tests/view/ribbon.smoke.test.ts`: add `"togglePin"` to the `names` array in `actions()` and `openThreadPinned: false,` to the `ctx()` defaults. In `ribbon-registry.test.ts`, extend the toggle-style test to `["contacts", "flag", "pin", "search"]`. In `tests/view/app.smoke.test.ts` `fakeVm`: add `toggleThreadPin: vi.fn(),` and `pinnedThreadIds: [],` to the default state.

`tests/view/thread-row.test.ts`:

```ts
describe("ThreadRow pinning", () => {
  const pinnedThread: ThreadView = { ...thread, pinned: true };

  it("shows a Pin button that reports the toggle without opening the thread", () => {
    const onTogglePin = vi.fn(); const onOpen = vi.fn();
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ onTogglePin, onOpen }) });
    flushSync();
    const btn = host.querySelector<HTMLButtonElement>('[data-action="pin"]')!;
    expect(btn.textContent).toContain("Pin");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    btn.click();
    expect(onTogglePin).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-pin")).toBeNull();
    expect(host.querySelector(".oe-thread-row")!.classList.contains("is-pinned")).toBe(false);
    unmount(app);
  });

  it("a pinned thread shows the indicator, the accent class and an Unpin button", () => {
    const host = document.createElement("div");
    const app = mount(ThreadRow, { target: host, props: baseProps({ thread: pinnedThread, onTogglePin: vi.fn() }) });
    flushSync();
    expect(host.querySelector(".oe-pin")).not.toBeNull();
    expect(host.querySelector(".oe-thread-row")!.classList.contains("is-pinned")).toBe(true);
    const btn = host.querySelector<HTMLButtonElement>('[data-action="pin"]')!;
    expect(btn.textContent).toContain("Unpin");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    unmount(app);
  });
});
```

`tests/view/message-list.smoke.test.ts`:

```ts
  it("passes the thread id to onTogglePin", () => {
    const onTogglePin = vi.fn();
    const host = document.createElement("div");
    const app = mount(MessageList, {
      target: host,
      props: { threads: [thread("t1")], openThreadId: null, hasMore: false, loading: false, onOpen: () => {}, onLoadMore: () => {}, onTogglePin },
    });
    host.querySelector<HTMLElement>('[data-action="pin"]')!.click();
    expect(onTogglePin).toHaveBeenCalledWith("t1");
    unmount(app);
  });
```

`tests/view/ribbon-registry.test.ts`:

```ts
describe("ribbon registry — pin", () => {
  it("Pin is a Home › Mark toggle: needs an open thread, pressed while pinned, mail-mode only", () => {
    expect(cmd("pin").tab).toBe("home");
    expect(cmd("pin").group).toBe("Mark");
    expect(enabled("pin", ctx({ hasOpenThread: false }))).toBe(false);
    expect(enabled("pin", ctx())).toBe(true);
    expect(enabled("pin", ctx({ mode: "contacts" }))).toBe(false);
    expect(cmd("pin").pressed?.(ctx({ openThreadPinned: true }))).toBe(true);
    const c = ctx();
    cmd("pin").run!(c);
    expect(c.actions.togglePin).toHaveBeenCalledOnce();
  });

  it("Home's groups are New, Respond, Manage, Mark, Sync, Search, View", () => {
    expect(groupsForTab("home", ctx())).toEqual(["New", "Respond", "Manage", "Mark", "Sync", "Search", "View"]);
  });
});
```

`tests/view/app.smoke.test.ts` (extend the "App — flagging" describe or add a sibling `describe("App — pinning")` reusing its `mountApp`/`click`/`openState`):

```ts
describe("App — pinning", () => {
  const mountApp = (vm: ViewModel, over: object = {}) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(App, { target: host, props: appProps(vm, over) });
    flushSync();
    return { host, done: () => { unmount(app); host.remove(); } };
  };
  const click = (el: Element | null) => { (el as HTMLElement).click(); flushSync(); };
  const openMessages = [{
    summary: {
      id: "m1", threadId: "t1", mailboxIds: ["INBOX"], from: { name: "Jane", email: "j@x.com" },
      to: [], cc: [], subject: "Hello", snippet: "", date: 1, unread: false, hasAttachments: false, flagged: false,
    },
  }];

  it("the row Pin button toggles that thread", () => {
    const vm = fakeVm();
    const { host, done } = mountApp(vm);
    click(host.querySelector('.oe-thread-row [data-action="pin"]'));
    expect(vm.toggleThreadPin).toHaveBeenCalledWith("t1");
    done();
  });

  it("the ribbon Pin button toggles the open thread and shows pressed when it is pinned", () => {
    const vm = fakeVm({ openThreadId: "t1", openMessages, pinnedThreadIds: ["t1"] });
    const { host, done } = mountApp(vm);
    const btn = host.querySelector<HTMLElement>('.oe-ribbon [data-action="pin"]')!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    click(btn);
    expect(vm.toggleThreadPin).toHaveBeenCalledWith("t1");
    done();
  });

  it("the thread context menu receives pin state and a working toggle", () => {
    const onThreadContextMenu = vi.fn();
    const vm = fakeVm({ pinnedThreadIds: ["t1"] });
    const { host, done } = mountApp(vm, { onThreadContextMenu });
    host.querySelector(".oe-thread-row")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const [, actions] = onThreadContextMenu.mock.calls[0];
    expect(actions.pinned).toBe(true);
    actions.onTogglePin();
    expect(vm.toggleThreadPin).toHaveBeenCalledWith("t1");
    done();
  });
});
```

(As in Task 5: if the ribbon button doesn't expose `aria-pressed`, assert whatever pressed marker the existing Search/Contacts tests use. In `fakeVm`, the default thread has no `pinned`; the context-menu test passes the pinned id via `pinnedThreadIds`, so `App` must derive the menu's `pinned` from `state.pinnedThreadIds`, not from the thread object.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/thread-row.test.ts tests/view/message-list.smoke.test.ts tests/view/ribbon-registry.test.ts tests/view/app.smoke.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Icons and `ThreadRow`**

`src/view/action-icons.ts`: add `pin: "pin", unpin: "pin-off",`.

`ThreadRow.svelte`: add prop `onTogglePin: () => void;`, `const pinned = $derived(thread.pinned ?? false);`, add `class:is-pinned={pinned}` to the row `<div>`, the indicator after the flag indicator in `oe-thread-line2`:

```svelte
    {#if pinned}<span class="oe-pin" role="img" aria-label="pinned" use:icon={ACTION_ICON.pin}></span>{/if}
```

and, in `oe-thread-actions` right after the Flag button:

```svelte
    <button type="button" data-action="pin" aria-pressed={pinned} onclick={(e) => { e.stopPropagation(); onTogglePin(); }}>
      <span class="oe-action-icon" use:icon={pinned ? ACTION_ICON.unpin : ACTION_ICON.pin}></span>{pinned ? "Unpin" : "Pin"}
    </button>
```

- [ ] **Step 4: `MessageList.svelte`**

Add `onTogglePin: (threadId: string) => void;` to the props and pass `onTogglePin={() => onTogglePin(t.threadId)}` to `<ThreadRow>`.

- [ ] **Step 5: Ribbon registry**

In `src/view/ribbon/registry.ts`: add `openThreadPinned: boolean;` to `RibbonContext`, `togglePin(): void;` to `RibbonActions`, add `"pin"` to `MAIL_ONLY`, and insert right after the `flag` command:

```ts
  { id: "pin", tab: "home", group: "Mark", icon: ACTION_ICON.pin, label: "Pin",
    enabled: (c) => c.hasOpenThread, pressed: (c) => c.openThreadPinned, run: (c) => c.actions.togglePin() },
```

- [ ] **Step 6: Context menu types and `main.ts`**

`src/view/mail-view.ts`: add to `ThreadMenuActions`:

```ts
  /** The conversation is pinned. */
  pinned: boolean;
  onTogglePin: () => void;
```

`src/main.ts`: extend the destructuring to `{ candidates, onMove, flagged, onToggleFlag, pinned, onTogglePin }` and add, after the Flag item and before Move:

```ts
      menu.addItem((item) =>
        item
          .setTitle(pinned ? "Unpin" : "Pin")
          .setIcon(pinned ? "pin-off" : "pin")
          .onClick(() => onTogglePin()),
      );
```

- [ ] **Step 7: `App.svelte`**

- `<MessageList …>`: add `onTogglePin={(id) => { void vm.toggleThreadPin(id); }}` and extend the context-menu actions object with

```svelte
            pinned: state.pinnedThreadIds.includes(id),
            onTogglePin: () => { void vm.toggleThreadPin(id); },
```

- `ribbonCtx`: add `openThreadPinned: state.openThreadId !== null && state.pinnedThreadIds.includes(state.openThreadId),` and, in `actions`, `togglePin: () => { const id = state.openThreadId; if (id) void vm.toggleThreadPin(id); },`.

- [ ] **Step 8: Styles**

Append to the Flags section of `styles.css`:

```css
.oe-pin { display: inline-flex; width: 14px; height: 14px; color: var(--interactive-accent); }
.oe-pin svg { width: 12px; height: 12px; }
/* Pinned rows read as one group at the top of the list. */
.oe-thread-row.is-pinned { box-shadow: inset 3px 0 0 var(--interactive-accent); }
```

- [ ] **Step 9: Run to verify pass, typecheck, build, full suite**

Run: `npx vitest run tests/view && npm run typecheck && npm run build 2>&1 | tail -10 && npm test`
Expected: PASS; build has no Svelte warnings.

- [ ] **Step 10: Commit**

```bash
git add src tests styles.css
git commit -m "feat: pin controls on thread rows, ribbon and context menu" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: View-model — the Flagged view

**Files:**
- Modify: `src/view/view-model.ts`
- Test: `tests/view/view-model.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 (`provider.listFlaggedMessages`, `cache.listFlaggedMessages`), Tasks 4 and 6 (`applyFlagChange`, `groupThreads`, `pinned`).
- Produces: `ViewState.flaggedActive: boolean`; `ViewModel.selectFlagged(): Promise<void>` (shows cached flagged threads, then fetches from the server); private `fetchFlagged(more)`; `loadMore()` and `refresh()` are flagged-aware; `selectMailbox`/`selectAccount` clear `flaggedActive`; `refreshMailboxes`' "active mailbox vanished" fallback is skipped while `flaggedActive`.

- [ ] **Step 1: Write failing tests**

Add a `describe` inside the top-level `describe("ViewModel", …)` in `tests/view/view-model.test.ts`:

```ts
  describe("flagged view", () => {
    type Ctx = Awaited<ReturnType<typeof build>>;
    const flaggedMsg = (id: string, thread: string, date: number, extra: Partial<MessageSummary> = {}): MessageSummary =>
      ({ ...sum(id, thread, date), flagged: true, ...extra });
    /** `cached` rows go into the cache; `server` rows into the fake provider. */
    async function seed(c: Ctx, cached: MessageSummary[], server: MessageSummary[] = cached) {
      await c.cache.putMailboxes("a1", [
        ...(await c.provider.listMailboxes()),
        { id: "TRASH", name: "Deleted Items", kind: "trash" },
      ]);
      await c.cache.upsertMessages("a1", cached);
      for (const m of server) c.provider.addMessage(m);
    }

    it("selectFlagged lists cached flagged threads across mailboxes, newest first, excluding unflagged and Trash", async () => {
      const c = await build();
      await seed(c, [
        flaggedMsg("f1", "t1", 5),
        flaggedMsg("f2", "t2", 9, { mailboxIds: ["SENT"] }),
        sum("plain", "t3", 10),
        flaggedMsg("gone", "t4", 12, { mailboxIds: ["TRASH"] }),
      ]);
      await c.vm.init();
      await c.vm.selectFlagged();
      expect(c.vm.getState().flaggedActive).toBe(true);
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t2", "t1"]);
    });

    it("fetches the rest from the server and caches it", async () => {
      const c = await build();
      await seed(c, [], [flaggedMsg("old", "t-old", 1)]);
      await c.vm.init();
      await c.vm.selectFlagged();
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t-old"]);
      expect((await c.cache.getThreadMessages("a1", "t-old")).map((m) => m.id)).toEqual(["old"]);
    });

    it("shows the cached rows before the server answers", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)], []);
      await c.vm.init();
      let release!: () => void;
      vi.spyOn(c.provider, "listFlaggedMessages").mockImplementation(
        () => new Promise((res) => { release = () => res({ items: [] }); }),
      );
      const pending = c.vm.selectFlagged();
      await vi.waitFor(() => expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]));
      release();
      await pending;
      expect(c.vm.getState().loadingList).toBe(false);
    });

    it("offline: shows the cached list, makes no request, and stays quiet", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)]);
      // Same construction the existing offline-search test uses (see `offlineVm`
      // near the top of this file): the shared deps with `isOnline: () => false`.
      const offline = new ViewModel({
        cache: c.cache, sync: c.sync, settings: c.settings, getProvider: () => c.provider, isOnline: () => false,
        openExternal: () => {}, saveBlob: async () => {}, saveNote: () => {},
        promptFolderName: () => {}, promptFolderRename: vi.fn(), pickNoteAttachment: vi.fn(), showNotice: c.showNotice,
        ...contactDeps(() => c.provider),
      });
      const spy = vi.spyOn(c.provider, "listFlaggedMessages");
      await offline.init();
      await offline.selectFlagged();
      expect(offline.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
      expect(spy).not.toHaveBeenCalled();
      expect(c.showNotice).not.toHaveBeenCalled();
    });

    it("a server failure keeps the cached list and toasts", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)]);
      await c.vm.init();
      vi.spyOn(c.provider, "listFlaggedMessages").mockRejectedValue(new Error("boom"));
      await c.vm.selectFlagged();
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
      expect(c.showNotice).toHaveBeenCalledWith(expect.stringMatching(/couldn't load flagged/i));
    });

    it("Load more follows the server's page token", async () => {
      const c = await build();
      c.provider.pageSize = 2;
      await seed(c, [], [flaggedMsg("a", "ta", 3), flaggedMsg("b", "tb", 2), flaggedMsg("c", "tc", 1)]);
      await c.vm.init();
      await c.vm.selectFlagged();
      expect(c.vm.getState().threads).toHaveLength(2);
      expect(c.vm.getState().hasMore).toBe(true);
      await c.vm.loadMore();
      expect(c.vm.getState().threads).toHaveLength(3);
      expect(c.vm.getState().hasMore).toBe(false);
    });

    it("unflagging inside the view removes the row; a server failure puts it back", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)]);
      await c.vm.init();
      await c.vm.selectFlagged();
      await c.vm.toggleThreadFlag("t1");
      expect(c.vm.getState().threads).toEqual([]);

      await c.vm.toggleThreadFlag("t1"); // flag it again from the (now stale) cache…
      // …the cache still holds it, so the row returns.
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);

      vi.spyOn(c.provider, "setMessageFlag").mockRejectedValue(new Error("boom"));
      await c.vm.toggleThreadFlag("t1");
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]); // rolled back
    });

    it("pinned threads still float to the top of the flagged list", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 1), flaggedMsg("f2", "t2", 9)]);
      await c.settings.pin("a1", "t1");
      await c.vm.init();
      await c.vm.selectFlagged();
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1", "t2"]);
    });

    it("selectMailbox leaves the view and lists that mailbox again", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5), sum("m2", "t2", 6)]);
      await c.vm.init();
      await c.vm.selectFlagged();
      await c.vm.selectMailbox("INBOX");
      expect(c.vm.getState().flaggedActive).toBe(false);
      expect(c.vm.getState().threads.map((t) => t.threadId).sort()).toEqual(["t1", "t2"]);
    });

    it("selectFlagged clears an active search and a composer, like selectMailbox", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)]);
      await c.vm.init();
      c.provider.setSearchResults("q", [sum("m9", "t9", 1)]);
      await c.vm.runSearch("q");
      c.vm.openNewMessage();
      await c.vm.selectFlagged();
      expect(c.vm.getState().search.active).toBe(false);
      expect(c.vm.getState().composer).toBeNull();
    });

    it("clearing a search made inside the view returns to the flagged list", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)]);
      await c.vm.init();
      await c.vm.selectFlagged();
      c.provider.setSearchResults("q", [sum("m9", "t9", 1)]);
      await c.vm.runSearch("q");
      await c.vm.clearSearch();
      expect(c.vm.getState().flaggedActive).toBe(true);
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
    });

    it("a folder vanishing during sync does not knock the user out of the view", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)]);
      await c.vm.init();
      await c.vm.selectFlagged();
      await c.cache.deleteMailboxes("a1", ["INBOX"]); // the previously active real mailbox disappears
      c.sync.changes.emit({ accountId: "a1", mailboxIds: [], reason: "incremental" });
      await new Promise((r) => setTimeout(r, 30));
      expect(c.vm.getState().flaggedActive).toBe(true);
      expect(c.vm.getState().threads.map((t) => t.threadId)).toEqual(["t1"]);
    });

    it("refresh re-fetches the flagged list", async () => {
      const c = await build();
      await seed(c, [flaggedMsg("f1", "t1", 5)]);
      await c.vm.init();
      await c.vm.selectFlagged();
      const spy = vi.spyOn(c.provider, "listFlaggedMessages");
      await c.vm.refresh();
      expect(spy).toHaveBeenCalledOnce();
    });
  });
```

(Add `MessageSummary` to the file's existing type import from `../../src/providers/types` if it isn't there — it is used by the `sum` helper already.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/view-model.test.ts -t "flagged view"`
Expected: FAIL (`selectFlagged is not a function`).

- [ ] **Step 3: Implement**

In `src/view/view-model.ts`:

1. `ViewState` gains `/** The virtual Flagged view is showing (not a mailbox). */ flaggedActive: boolean;` (initial `flaggedActive: false`), and the class gets `private flaggedToken: string | undefined;` beside `providerListToken`.

2. `selectMailbox` becomes:

```ts
  async selectMailbox(id: string): Promise<void> {
    this.flaggedToken = undefined;
    this.set({ activeMailboxId: id, flaggedActive: false, search: { query: "", active: false }, composer: null });
    this.providerListToken = undefined;
    this.providerListExhausted = false;
    await this.reloadList();
  }
```

In `selectAccount`'s `this.set({ … })` add `flaggedActive: false,` (and reset `this.flaggedToken = undefined;` just before it).

3. Add `selectFlagged` and `fetchFlagged` next to `selectMailbox`:

```ts
  /** The virtual Flagged view: cached flagged threads appear immediately, then
   *  the rest is fetched from the server (old flagged mail may never have been
   *  backfilled into the cache). */
  async selectFlagged(): Promise<void> {
    this.flaggedToken = undefined;
    this.set({ flaggedActive: true, search: { query: "", active: false }, composer: null });
    await this.reloadList();
    await this.fetchFlagged(false);
  }

  private async fetchFlagged(more: boolean): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) return;
    if (!this.deps.isOnline()) return; // cached list only; offline is not an error
    if (more && this.flaggedToken === undefined) return;
    this.set({ loadingList: true });
    try {
      const page = await provider.listFlaggedMessages(more ? this.flaggedToken : undefined);
      if (page.items.length) await this.deps.cache.upsertMessages(acct, page.items);
      if (acct !== this.state.activeAccountId || !this.state.flaggedActive) return; // navigated away
      this.flaggedToken = page.nextPageToken;
    } catch {
      this.deps.showNotice("Couldn't load flagged messages.");
    }
    await this.reloadList();
  }
```

4. In `reloadList`, replace the two guard lines and insert the flagged branch, so the top of the method reads:

```ts
  private async reloadList(): Promise<void> {
    const acct = this.state.activeAccountId;
    const mb = this.state.activeMailboxId;
    const flaggedView = this.state.flaggedActive;
    if (!acct || (!mb && !flaggedView)) return;
    // (existing comment about overlapping reads)
    const seq = ++this.reloadSeq;
    this.set({ loadingList: true });
    if (flaggedView) {
      const rows = await this.deps.cache.listFlaggedMessages(acct);
      const pinned = this.deps.settings.pinnedThreadIds(acct);
      if (seq !== this.reloadSeq) return;
      this.set({
        threads: groupThreads(rows, pinned),
        pinnedThreadIds: [...pinned],
        // Another server page exists only once a fetch returned a token.
        hasMore: this.flaggedToken !== undefined,
        loadingList: false,
      });
      return;
    }
    if (!mb) return;
    // …the existing mailbox path continues here unchanged…
```

5. `loadMore`: add at the top

```ts
    if (this.state.flaggedActive) {
      if (!this.state.search.active) await this.fetchFlagged(true);
      return;
    }
```

6. `refresh()`: after the `syncAccount` line add `if (this.state.flaggedActive) await this.fetchFlagged(false);`.

7. `refreshMailboxes`: change the early-return line to

```ts
    if (sorted.length === 0 || this.state.flaggedActive || sorted.some((m) => m.id === this.state.activeMailboxId)) return;
```

(add a short comment: the Flagged view has no active mailbox to fall back from).

8. Make `applyFlagChange` reload the flagged view: change its signature to `private async applyFlagChange(…): Promise<void>`, add at its end `if (this.state.flaggedActive) await this.reloadList();`, and `await` it at both call sites in `setFlags`.

- [ ] **Step 4: Run to verify pass + typecheck + full suite**

Run: `npx vitest run tests/view/view-model.test.ts && npm run typecheck && npm test`
Expected: PASS. (One pre-existing search test is known to be flaky under full runs — "re-reads the list when the sync engine emits a change for the active mailbox"; re-run before concluding anything.)

- [ ] **Step 5: Commit**

```bash
git add src/view/view-model.ts tests/view/view-model.test.ts
git commit -m "feat: virtual Flagged view — cached first, then fetched from the server" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Flagged view UI

**Files:**
- Modify: `src/view/components/MailboxList.svelte`, `src/view/components/MessageList.svelte`, `src/view/App.svelte`
- Test: `tests/view/mailbox-list.smoke.test.ts`, `tests/view/message-list.smoke.test.ts`, `tests/view/app.smoke.test.ts`

**Interfaces:**
- Consumes: Task 8 (`vm.selectFlagged`, `ViewState.flaggedActive`).
- Produces: `MailboxList` props `flaggedActive: boolean`, `onSelectFlagged(): void`; a first button `.oe-mailbox-flagged[data-view="flagged"]` ("Flagged", flag icon), `is-active` when `flaggedActive`, not a drag/drop target; `MessageList` optional prop `emptyText?: string` (default "No messages"); in `App`, while `flaggedActive` no real mailbox is active, archive/delete/drafts flags are false, and Move destinations are every mailbox.

- [ ] **Step 1: Update the helper and write failing tests**

In `tests/view/app.smoke.test.ts` `fakeVm`: add `selectFlagged: vi.fn(),` and `flaggedActive: false,` to the default state.

`tests/view/mailbox-list.smoke.test.ts` (uses `mailboxes`, `dragEvent`):

```ts
describe("MailboxList Flagged entry", () => {
  const props = (over: Record<string, unknown> = {}) => ({
    mailboxes, activeId: "INBOX", flaggedActive: false,
    onSelect: vi.fn(), onSelectFlagged: vi.fn(), onDropThread: vi.fn(), ...over,
  });

  it("renders Flagged first, with the flag icon, and reports a click", () => {
    const onSelectFlagged = vi.fn();
    const host = document.createElement("div");
    const app = mount(MailboxList, { target: host, props: props({ onSelectFlagged }) });
    flushSync();
    const first = host.querySelector<HTMLElement>(".oe-mailbox")!;
    expect(first.classList.contains("oe-mailbox-flagged")).toBe(true);
    expect(first.textContent).toContain("Flagged");
    expect(first.querySelector(".oe-mailbox-icon")!.getAttribute("data-icon")).toBe("flag");
    first.click();
    expect(onSelectFlagged).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("is active only while flaggedActive (the page passes no active mailbox then)", () => {
    const host = document.createElement("div");
    const app = mount(MailboxList, { target: host, props: props({ flaggedActive: true, activeId: null }) });
    flushSync();
    expect(host.querySelector(".oe-mailbox-flagged")!.classList.contains("is-active")).toBe(true);
    expect(host.querySelectorAll(".oe-mailbox.is-active")).toHaveLength(1);
    unmount(app);
  });

  it("is not a drop target for dragged threads", () => {
    const onDropThread = vi.fn();
    const host = document.createElement("div");
    const app = mount(MailboxList, { target: host, props: props({ onDropThread }) });
    flushSync();
    const flagged = host.querySelector(".oe-mailbox-flagged")!;
    const over = dragEvent("dragover", { types: [THREAD_DRAG_TYPE], getData: () => "t1" });
    flagged.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    flagged.dispatchEvent(dragEvent("drop", { types: [THREAD_DRAG_TYPE], getData: () => "t1" }));
    expect(onDropThread).not.toHaveBeenCalled();
    unmount(app);
  });
});
```

`tests/view/message-list.smoke.test.ts`:

```ts
  it("uses the given empty text", () => {
    const host = document.createElement("div");
    const app = mount(MessageList, {
      target: host,
      props: { threads: [], openThreadId: null, hasMore: false, loading: false, onOpen: () => {}, onLoadMore: () => {}, emptyText: "No flagged messages" },
    });
    expect(host.textContent).toContain("No flagged messages");
    unmount(app);
  });
```

`tests/view/app.smoke.test.ts` (new describe reusing the mount/click helpers as in the earlier describes):

```ts
describe("App — Flagged view", () => {
  const mountApp = (vm: ViewModel, over: object = {}) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(App, { target: host, props: appProps(vm, over) });
    flushSync();
    return { host, done: () => { unmount(app); host.remove(); } };
  };
  const click = (el: Element | null) => { (el as HTMLElement).click(); flushSync(); };

  it("clicking Flagged selects the view", () => {
    const vm = fakeVm();
    const { host, done } = mountApp(vm);
    click(host.querySelector(".oe-mailbox-flagged"));
    expect(vm.selectFlagged).toHaveBeenCalledOnce();
    done();
  });

  it("selecting Flagged with an unsent message asks first", () => {
    const vm = fakeVm();
    (vm.hasUnsavedComposerContent as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const { host, done } = mountApp(vm);
    click(host.querySelector(".oe-mailbox-flagged"));
    expect(vm.selectFlagged).not.toHaveBeenCalled();
    expect(host.querySelector(".oe-composer-prompt")).not.toBeNull();
    done();
  });

  it("while flagged is active only Flagged is highlighted and the empty state says so", () => {
    const vm = fakeVm({ flaggedActive: true, threads: [] });
    const { host, done } = mountApp(vm);
    expect(host.querySelectorAll(".oe-mailbox.is-active")).toHaveLength(1);
    expect(host.querySelector(".oe-mailbox-flagged")!.classList.contains("is-active")).toBe(true);
    expect(host.textContent).toContain("No flagged messages");
    done();
  });

  it("in the Flagged view Move offers every folder, including the one last active", () => {
    const onThreadContextMenu = vi.fn();
    const vm = fakeVm({ flaggedActive: true });
    const { host, done } = mountApp(vm, { onThreadContextMenu });
    host.querySelector(".oe-thread-row")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const [, actions] = onThreadContextMenu.mock.calls[0];
    expect(actions.candidates.map((m: { id: string }) => m.id)).toEqual(["INBOX"]);
    done();
  });

  it("in the Flagged view a row's Archive is offered (no active folder rules apply)", () => {
    const vm = fakeVm({ flaggedActive: true, mailboxes: [{ id: "DRAFTS", name: "Drafts", kind: "drafts" }], activeMailboxId: "DRAFTS" });
    const { host, done } = mountApp(vm);
    expect(host.querySelector('.oe-thread-row [data-action="archive"]')).not.toBeNull();
    done();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/mailbox-list.smoke.test.ts tests/view/message-list.smoke.test.ts tests/view/app.smoke.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: `MailboxList.svelte`**

Add `import { ACTION_ICON } from "../action-icons";`, add `flaggedActive` and `onSelectFlagged` to the props (`flaggedActive: boolean; onSelectFlagged: () => void;`), and render this before the `{#each}`:

```svelte
  <button
    type="button" class="oe-mailbox oe-mailbox-flagged" class:is-active={flaggedActive}
    data-view="flagged" onclick={onSelectFlagged}
  >
    <span class="oe-mailbox-icon" use:icon={ACTION_ICON.flag}></span>
    <span class="oe-mailbox-name">Flagged</span>
  </button>
```

(It has no drag handlers, so it is neither a drop target nor accepts `dragover`.)

- [ ] **Step 4: `MessageList.svelte`**

Add an optional prop `emptyText = "No messages"` (typed `emptyText?: string`) and use it: `<p class="oe-empty">{emptyText}</p>`.

- [ ] **Step 5: `App.svelte`**

- Move the `activeMailbox` derivation above the three `is…Mailbox` deriveds and make it flagged-aware, then derive the three flags from it:

```ts
  const activeMailbox = $derived(
    state.flaggedActive ? null : (state.mailboxes.find((m) => m.id === state.activeMailboxId) ?? null),
  );
  const isDraftsMailbox = $derived(activeMailbox?.kind === "drafts");
  const isArchiveMailbox = $derived(activeMailbox?.kind === "archive");
  const isTrashMailbox = $derived(activeMailbox?.kind === "trash");
```

- Add, next to them, the Move destinations (every folder while the Flagged view is showing):

```ts
  const moveTargets = $derived(
    state.flaggedActive ? state.mailboxes : state.mailboxes.filter((m) => m.id !== state.activeMailboxId),
  );
```

  and use it: in `ribbonCtx` `otherMailboxes: moveTargets.map((m) => ({ id: m.id, name: m.name })),` and in the thread context-menu actions `candidates: moveTargets,`.

- `<MailboxList …>`: pass `activeId={state.flaggedActive ? null : state.activeMailboxId}`, `flaggedActive={state.flaggedActive}`, `onSelectFlagged={() => requestSwitch(() => vm.selectFlagged())}`.
- `<MessageList …>`: add `emptyText={state.flaggedActive ? "No flagged messages" : undefined}`.

- [ ] **Step 6: Run to verify pass, typecheck, build, full suite**

Run: `npx vitest run tests/view && npm run typecheck && npm run build 2>&1 | tail -10 && npm test`
Expected: PASS; no Svelte warnings.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat: Flagged entry in the folder pane" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Final verification

**Files:** none (verification only; fix anything found in the task that owns it).

- [ ] **Step 1: Full verification**

```bash
npm run typecheck
npm test
npm run build
```
Expected: typecheck clean; all tests pass; the build succeeds with **no Svelte warnings**.

- [ ] **Step 2: Mutation spot-checks**

Temporarily break each, run the named test, confirm it FAILS, then revert exactly (`git diff` empty for the file afterwards):
1. `view-model.ts` `setFlags`: delete the rollback `await write(!flagged, failed);` line → `tests/view/view-model.test.ts -t "rolls back the cache"` fails.
2. `mail-cache.ts` `pruneSummaries`: drop the `!r.flagged &&` condition → `tests/cache/mail-cache.test.ts -t "never prunes a flagged"` fails.
3. `view-model.ts` `reloadList`: skip the pinned-extras loop → `-t "older than the loaded page"` fails.
4. `view-model.ts` `refreshMailboxes`: remove `this.state.flaggedActive ||` → `-t "does not knock the user out"` fails.
5. `settings-store.ts` `mutatePins`: remove the revert in the `catch` → `tests/settings/settings-store.test.ts -t "reverts the in-memory change"` fails.
A mutation that does NOT cause a failure is a test gap — report it.

- [ ] **Step 3: Manual smoke (real Obsidian, if available — otherwise list it for the user)**

- Flag a thread from the row, ribbon, right-click menu and a message header; confirm it shows in Outlook on the web after the change, and that flagging in Outlook appears here after a sync.
- The Flagged view lists old flagged mail that was never backfilled (server fetch), pages with Load more, and unflagging removes the row. **Open item:** confirm Graph accepts `$filter=flag/flagStatus eq 'flagged'` for both a work and a personal account (no `InefficientFilter`/`ErrorInvalidOrderByFilter`); if not, switch `listFlaggedMessages` to per-folder queries and update the spec.
- Pin a thread; it sorts to the top, survives reload, survives moving/archiving it, and an old pinned thread still shows after pruning.
- Icons render: `flag`, `flag-off`, `pin`, `pin-off`. The nested flag button in a message header does not expand/collapse the message with the mouse or keyboard. The right-click menu order reads Flag, Pin, Move.

- [ ] **Step 4: Finish**

Use `superpowers:finishing-a-development-branch`. The release for this feature is `npm run release minor` (→ 0.6.0); run it only when the user asks for the bump.
