import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Contact } from "../providers/types";

/**
 * Contacts live in their OWN database, not in the mail one. Adding a store to
 * `obsidian-email` meant bumping it to v2, and the shipped 0.4.1 never closes
 * its v1 connections — so an in-place update (old instance still alive in the
 * same renderer) blocked the v2 upgrade until Obsidian restarted. A separate
 * database at v1 has no older instance holding it, so it can never block.
 */
export const CONTACT_DB_NAME = "obsidian-email-contacts";
export const CONTACT_DB_VERSION = 1;

export interface StoredContact extends Contact {
  key: string;       // `${accountId}/${id}`
  accountId: string;
}

export interface ContactDb extends DBSchema {
  contacts: { key: string; value: StoredContact; indexes: { "by-account": string } };
}

export function openContactDb(name: string = CONTACT_DB_NAME): Promise<IDBPDatabase<ContactDb>> {
  // Same self-close pattern as openMailDb: get out of the way of a future
  // upgrade by another connection rather than blocking it. The closure
  // captures the resolved handle; `event.target` is the same connection and
  // covers `blocking` firing before the promise settles.
  let handle: IDBPDatabase<ContactDb> | undefined;
  return openDB<ContactDb>(name, CONTACT_DB_VERSION, {
    blocking(_currentVersion, _blockedVersion, event) {
      if (handle) handle.close();
      else (event.target as IDBDatabase | null)?.close();
    },
    upgrade(db) {
      const contacts = db.createObjectStore("contacts", { keyPath: "key" });
      contacts.createIndex("by-account", "accountId");
    },
  }).then((opened) => (handle = opened));
}
