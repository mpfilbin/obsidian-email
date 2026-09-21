import type { IDBPDatabase } from "idb";
import type { Contact } from "../providers/types";
import { openContactDb, type ContactDb } from "./contact-schema";
import { sortContacts } from "../view/contact-draft";

const key = (accountId: string, id: string) => `${accountId}/${id}`;

/** What `ContactSync` and the view-model need from contact storage. */
export interface ContactStore {
  list(accountId: string): Promise<Contact[]>;
  put(accountId: string, contact: Contact): Promise<void>;
  remove(accountId: string, id: string): Promise<void>;
  /** Upserts every contact in `contacts` and deletes any cached one not in it. */
  replace(accountId: string, contacts: Contact[]): Promise<void>;
  clear(accountId: string): Promise<void>;
  /** Removes every account's contacts. */
  clearAll(): Promise<void>;
  /** Releases any underlying connection; the in-memory store is a no-op. */
  close(): void;
}

export class ContactCache implements ContactStore {
  private constructor(private db: IDBPDatabase<ContactDb>) {}

  static async open(name?: string): Promise<ContactCache> {
    return new ContactCache(await openContactDb(name));
  }

  async list(accountId: string): Promise<Contact[]> {
    const rows = await this.db.getAllFromIndex("contacts", "by-account", accountId);
    return sortContacts(rows.map(({ key: _k, accountId: _a, ...contact }) => contact));
  }

  async put(accountId: string, contact: Contact): Promise<void> {
    await this.db.put("contacts", { ...contact, key: key(accountId, contact.id), accountId });
  }

  async remove(accountId: string, id: string): Promise<void> {
    await this.db.delete("contacts", key(accountId, id));
  }

  async replace(accountId: string, contacts: Contact[]): Promise<void> {
    const existing = await this.db.getAllKeysFromIndex("contacts", "by-account", accountId);
    const keep = new Set(contacts.map((c) => key(accountId, c.id)));
    const tx = this.db.transaction("contacts", "readwrite");
    await Promise.all([
      ...contacts.map((c) => tx.store.put({ ...c, key: key(accountId, c.id), accountId })),
      ...existing.filter((k) => !keep.has(k)).map((k) => tx.store.delete(k)),
    ]);
    await tx.done;
  }

  async clear(accountId: string): Promise<void> {
    const keys = await this.db.getAllKeysFromIndex("contacts", "by-account", accountId);
    const tx = this.db.transaction("contacts", "readwrite");
    await Promise.all(keys.map((k) => tx.store.delete(k)));
    await tx.done;
  }

  async clearAll(): Promise<void> {
    await this.db.clear("contacts");
  }

  /** Releases the IndexedDB connection (see MailCache.close). */
  close(): void {
    this.db.close();
  }
}

/** Degraded-mode stand-in (IndexedDB unavailable): contacts still load from
 *  the provider and live in memory for the session. Also handy in tests. */
export class MemoryContactStore implements ContactStore {
  private byAccount = new Map<string, Map<string, Contact>>();

  private bucket(accountId: string): Map<string, Contact> {
    let b = this.byAccount.get(accountId);
    if (!b) this.byAccount.set(accountId, (b = new Map()));
    return b;
  }

  async list(accountId: string): Promise<Contact[]> {
    return sortContacts([...this.bucket(accountId).values()]);
  }
  async put(accountId: string, contact: Contact): Promise<void> {
    this.bucket(accountId).set(contact.id, contact);
  }
  async remove(accountId: string, id: string): Promise<void> {
    this.bucket(accountId).delete(id);
  }
  async replace(accountId: string, contacts: Contact[]): Promise<void> {
    this.byAccount.set(accountId, new Map(contacts.map((c) => [c.id, c])));
  }
  async clear(accountId: string): Promise<void> {
    this.byAccount.delete(accountId);
  }
  async clearAll(): Promise<void> {
    this.byAccount.clear();
  }
  close(): void {
    // Nothing to release.
  }
}
