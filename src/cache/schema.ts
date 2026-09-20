import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Contact, Mailbox, MessageBody, MessageSummary, SyncCursor } from "../providers/types";

export const DB_NAME = "obsidian-email";
export const DB_VERSION = 2;

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
export interface StoredContact extends Contact {
  key: string;       // `${accountId}/${id}`
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
  contacts: { key: string; value: StoredContact; indexes: { "by-account": string } };
  cursors: { key: string; value: StoredCursor };
  meta: { key: string; value: unknown };
}

export function openMailDb(name: string = DB_NAME): Promise<IDBPDatabase<MailDb>> {
  return openDB<MailDb>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Guarded by oldVersion so an existing v1 database only gains what's
      // new — createObjectStore throws if the store already exists.
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
      if (oldVersion < 2) {
        const contacts = db.createObjectStore("contacts", { keyPath: "key" });
        contacts.createIndex("by-account", "accountId");
      }
    },
  });
}
