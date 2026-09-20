import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Mailbox, MessageBody, MessageSummary, SyncCursor } from "../providers/types";

export const DB_NAME = "obsidian-email";
export const DB_VERSION = 1;

export const RETENTION = {
  summaryDays: 90,
  summaryPerMailbox: 2000,
  bodyPerAccount: 200,
  bodyMaxAgeDays: 30,
} as const;

export interface StoredMessage extends MessageSummary {
  key: string;       // `${accountId}/${id}`
  accountId: string;
}
export interface StoredBody extends MessageBody {
  key: string;
  accountId: string;
  cachedAt: number;
}
export interface StoredMailbox extends Mailbox {
  key: string;
  accountId: string;
}
export interface StoredCursor {
  accountId: string;
  cursor: SyncCursor;
  backfillDone: boolean;
}

export interface MailDb extends DBSchema {
  mailboxes: { key: string; value: StoredMailbox; indexes: { "by-account": string } };
  messages: {
    key: string;
    value: StoredMessage;
    indexes: { "by-account": string; "by-account-date": [string, number]; "by-account-thread": [string, string] };
  };
  bodies: { key: string; value: StoredBody; indexes: { "by-account": string; "by-account-cachedAt": [string, number] } };
  cursors: { key: string; value: StoredCursor };
  meta: { key: string; value: unknown };
}

export function openMailDb(name: string = DB_NAME): Promise<IDBPDatabase<MailDb>> {
  // Deliberately NO version argument. With none, IndexedDB opens the database
  // at whatever version already exists (creating v1 and running `upgrade` from
  // 0 when it doesn't), so:
  //  - an existing v1 database is opened as-is: no upgrade, hence nothing for
  //    an older plugin instance's still-open v1 connections to block (the
  //    shipped 0.4.1 never closes them, and an in-place update runs the new
  //    code alongside the old instance);
  //  - a developer database that an earlier branch build bumped to v2 opens
  //    too, where requesting v1 would throw a VersionError.
  // `DB_VERSION` documents the schema this code creates; it is not requested.
  // Any future change to the mail schema must introduce an explicit version
  // deliberately, and think about old instances blocking that upgrade first.
  //
  // `blocking` fires on this connection when *another* connection wants to
  // upgrade past the current version. Getting out of the way keeps a future
  // upgrade from hanging on us. The closure captures the resolved handle;
  // `event.target` is the same connection and covers the (impossible in
  // practice) case of `blocking` firing before the promise settles.
  let handle: IDBPDatabase<MailDb> | undefined;
  return openDB<MailDb>(name, undefined, {
    blocking(_currentVersion, _blockedVersion, event) {
      if (handle) handle.close();
      else (event.target as IDBDatabase | null)?.close();
    },
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const mailboxes = db.createObjectStore("mailboxes", { keyPath: "key" });
        mailboxes.createIndex("by-account", "accountId");

        const messages = db.createObjectStore("messages", { keyPath: "key" });
        messages.createIndex("by-account", "accountId");
        messages.createIndex("by-account-date", ["accountId", "date"]);
        messages.createIndex("by-account-thread", ["accountId", "threadId"]);

        const bodies = db.createObjectStore("bodies", { keyPath: "key" });
        bodies.createIndex("by-account", "accountId");
        bodies.createIndex("by-account-cachedAt", ["accountId", "cachedAt"]);

        db.createObjectStore("cursors", { keyPath: "accountId" });
        db.createObjectStore("meta");
      }
    },
  }).then((opened) => (handle = opened));
}
