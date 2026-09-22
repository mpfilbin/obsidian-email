import type { IDBPDatabase } from "idb";
import type { Mailbox, MessageBody, MessageSummary, MessageSummaryPatch } from "../providers/types";
import { RETENTION, openMailDb, type MailDb, type StoredMessage } from "./schema";

const DAY_MS = 24 * 3600 * 1000;
const key = (accountId: string, id: string) => `${accountId}/${id}`;

export class MailCache {
  private lastCachedAt = 0;

  private constructor(private db: IDBPDatabase<MailDb>) {}

  static async open(name?: string): Promise<MailCache> {
    return new MailCache(await openMailDb(name));
  }

  async putMailboxes(accountId: string, boxes: Mailbox[]): Promise<void> {
    const tx = this.db.transaction("mailboxes", "readwrite");
    await Promise.all(
      boxes.map((b) => tx.store.put({ ...b, key: key(accountId, b.id), accountId })),
    );
    await tx.done;
  }

  async getMailboxes(accountId: string): Promise<Mailbox[]> {
    const rows = await this.db.getAllFromIndex("mailboxes", "by-account", accountId);
    return rows.map(({ key: _k, accountId: _a, ...box }) => box);
  }

  /** Removes specific mailboxes by id — used when the user deletes a folder
   *  (as opposed to replaceMailboxes' full-list reconcile from a sync). */
  async deleteMailboxes(accountId: string, ids: string[]): Promise<void> {
    const tx = this.db.transaction("mailboxes", "readwrite");
    await Promise.all(ids.map((id) => tx.store.delete(key(accountId, id))));
    await tx.done;
  }

  /** Replaces the cached folder list wholesale: upserts every box in `boxes`
   *  and deletes any cached mailbox for this account that isn't in it (a
   *  folder deleted server-side, e.g. from another mail client). Returns the
   *  removed ids so the caller can also clean up messages that belonged only
   *  to those folders. */
  async replaceMailboxes(accountId: string, boxes: Mailbox[]): Promise<string[]> {
    const existing = await this.db.getAllFromIndex("mailboxes", "by-account", accountId);
    const keep = new Set(boxes.map((b) => b.id));
    const removed = existing.filter((m) => !keep.has(m.id));
    const tx = this.db.transaction("mailboxes", "readwrite");
    await Promise.all([
      ...boxes.map((b) => tx.store.put({ ...b, key: key(accountId, b.id), accountId })),
      ...removed.map((m) => tx.store.delete(m.key)),
    ]);
    await tx.done;
    return removed.map((m) => m.id);
  }

  /** Removes the given (now-gone) mailboxes from every cached message's
   *  membership — see replaceMailboxes. A message is only deleted outright
   *  once none of its mailboxIds survive; one still belonging to a mailbox
   *  that wasn't removed keeps its row, just without the stale id. In
   *  practice a Graph message has exactly one mailboxId, but the type
   *  doesn't guarantee that, and getting this wrong would silently delete a
   *  message that's still visible in a mailbox we didn't touch. */
  async deleteMessagesByMailbox(accountId: string, mailboxIds: string[]): Promise<void> {
    if (!mailboxIds.length) return;
    const doomed = new Set(mailboxIds);
    const rows = await this.db.getAllFromIndex("messages", "by-account", accountId);
    const affected = rows.filter((r) => r.mailboxIds.some((id) => doomed.has(id)));
    if (!affected.length) return;
    const tx = this.db.transaction("messages", "readwrite");
    await Promise.all(
      affected.map((r) => {
        const remaining = r.mailboxIds.filter((id) => !doomed.has(id));
        return remaining.length === 0 ? tx.store.delete(r.key) : tx.store.put({ ...r, mailboxIds: remaining });
      }),
    );
    await tx.done;
  }

  async upsertMessages(accountId: string, msgs: MessageSummary[]): Promise<void> {
    const tx = this.db.transaction("messages", "readwrite");
    await Promise.all(
      msgs.map((m) => {
        const merged: StoredMessage = {
          ...m,
          mailboxIds: [...new Set(m.mailboxIds)],
          key: key(accountId, m.id),
          accountId,
        };
        return tx.store.put(merged);
      }),
    );
    await tx.done;
  }

  /** Merges a sync-time patch onto whatever is already cached for that
   *  message, rather than overwriting it outright: a field the patch omits
   *  keeps its previous cached value instead of being blanked out. This
   *  matters because Microsoft Graph's mail delta endpoint sometimes reports
   *  only the property that actually changed (e.g. isRead) and omits
   *  subject/from/etc. entirely — treating that as a full record wipes
   *  perfectly good cached data. A message with no existing cached row (a
   *  genuinely new message) falls back to placeholder defaults for whatever
   *  the patch itself didn't include. */
  async patchMessages(accountId: string, patches: MessageSummaryPatch[]): Promise<void> {
    const tx = this.db.transaction("messages", "readwrite");
    await Promise.all(
      patches.map(async (p) => {
        const k = key(accountId, p.id);
        const existing = await tx.store.get(k);
        const base: MessageSummary = existing ?? {
          id: p.id,
          threadId: p.id,
          mailboxIds: [],
          from: { email: "" },
          to: [],
          cc: [],
          subject: "(no subject)",
          snippet: "",
          date: Date.now(),
          unread: false,
          hasAttachments: false,
          flagged: false,
        };
        const merged: StoredMessage = {
          ...base,
          ...p,
          mailboxIds: [...new Set(p.mailboxIds)],
          key: k,
          accountId,
        };
        return tx.store.put(merged);
      }),
    );
    await tx.done;
  }

  /** Sets the flag on already-cached messages and nothing else. Unlike
   *  `patchMessages` this never creates a row: an id that isn't cached is
   *  simply skipped. Both matter for the optimistic flag path, whose rollback
   *  runs after a server round-trip — by then the message may have been moved
   *  (so re-writing the `mailboxIds` captured before the call would undo the
   *  move) or deleted (so re-creating it would resurrect a blank placeholder
   *  dated now, at the top of the Inbox, that nothing ever prunes). */
  async setFlagged(accountId: string, ids: string[], flagged: boolean): Promise<void> {
    if (!ids.length) return;
    const tx = this.db.transaction("messages", "readwrite");
    await Promise.all(
      ids.map(async (id) => {
        const row = await tx.store.get(key(accountId, id));
        if (!row) return;
        await tx.store.put({ ...row, flagged });
      }),
    );
    await tx.done;
  }

  async deleteMessages(accountId: string, ids: string[]): Promise<void> {
    const tx = this.db.transaction("messages", "readwrite");
    await Promise.all(ids.map((id) => tx.store.delete(key(accountId, id))));
    await tx.done;
  }

  async listMailboxMessages(
    accountId: string,
    mailboxId: string,
    opts: { limit?: number; before?: number } = {},
  ): Promise<MessageSummary[]> {
    const limit = opts.limit ?? 50;
    const range = IDBKeyRange.bound(
      [accountId, -Infinity],
      [accountId, opts.before ?? Infinity],
      false,
      true,
    );
    // Ascending by [accountId, date]; walk from the newest end.
    const rows = await this.db.getAllFromIndex("messages", "by-account-date", range);
    const out: MessageSummary[] = [];
    for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
      const v = rows[i];
      if (v.mailboxIds.includes(mailboxId)) {
        const { key: _k, accountId: _a, ...summary } = v;
        out.push(summary);
      }
    }
    return out;
  }

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

  async getThreadMessages(accountId: string, threadId: string): Promise<MessageSummary[]> {
    const rows = await this.db.getAllFromIndex("messages", "by-account-thread", [accountId, threadId]);
    return rows
      .map(({ key: _k, accountId: _a, ...s }) => s)
      .sort((a, b) => a.date - b.date);
  }

  async putBody(accountId: string, body: MessageBody): Promise<void> {
    const cachedAt = Math.max(Date.now(), this.lastCachedAt + 1);
    this.lastCachedAt = cachedAt;
    await this.db.put("bodies", { ...body, key: key(accountId, body.id), accountId, cachedAt });
  }

  async getBody(accountId: string, id: string): Promise<MessageBody | undefined> {
    const row = await this.db.get("bodies", key(accountId, id));
    if (!row) return undefined;
    const { key: _k, accountId: _a, cachedAt: _c, ...body } = row;
    return body;
  }

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

  private async pruneBodies(accountId: string, now: number): Promise<void> {
    const rows = (await this.db.getAllFromIndex("bodies", "by-account", accountId))
      .sort((a, b) => b.cachedAt - a.cachedAt);
    const ageCutoff = now - RETENTION.bodyMaxAgeDays * DAY_MS;
    const tx = this.db.transaction("bodies", "readwrite");
    const doomed = rows.filter((r, i) => i >= RETENTION.bodyPerAccount || r.cachedAt < ageCutoff);
    await Promise.all(doomed.map((r) => tx.store.delete(r.key)));
    await tx.done;
  }

  async clearAccount(accountId: string): Promise<void> {
    for (const storeName of ["messages", "bodies", "mailboxes"] as const) {
      const tx = this.db.transaction(storeName, "readwrite");
      const keys = await tx.store.index("by-account").getAllKeys(accountId);
      await Promise.all(keys.map((k) => tx.store.delete(k)));
      await tx.done;
    }
    await this.db.delete("cursors", accountId);
  }

  async clearAll(): Promise<void> {
    for (const storeName of ["messages", "bodies", "mailboxes", "cursors", "meta"] as const) {
      await this.db.clear(storeName);
    }
  }

  /** Releases the IndexedDB connection. A connection left open after the
   *  plugin unloads blocks the next version's upgrade (see openMailDb). */
  close(): void {
    this.db.close();
  }
}
