import { describe, it, expect } from "vitest";
import { openDB, type IDBPDatabase } from "idb";
import { openMailDb, DB_VERSION } from "../../src/cache/schema";

function createMailStores(db: IDBPDatabase): void {
  db.createObjectStore("mailboxes", { keyPath: "key" }).createIndex("by-account", "accountId");
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

/** The database exactly as the shipped 0.4.1 plugin creates it. */
function openV1(name: string): Promise<IDBPDatabase> {
  return openDB(name, 1, { upgrade: createMailStores });
}

/** A developer machine that ran an earlier branch build: v2 plus `contacts`. */
function openV2WithContacts(name: string): Promise<IDBPDatabase> {
  return openDB(name, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) createMailStores(db);
      db.createObjectStore("contacts", { keyPath: "key" }).createIndex("by-account", "accountId");
    },
  });
}

const freshName = (prefix: string) => `${prefix}-${Date.now()}-${Math.random()}`;
const PROMPT_MS = 1000;

/** Resolves to "timeout" instead of hanging the suite when `p` never settles. */
function settlesWithin<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);
}

describe("mail database schema", () => {
  it("stays at version 1", () => {
    expect(DB_VERSION).toBe(1);
  });

  // THE regression: the shipped 0.4.1 never closes its v1 connections, and an
  // in-place plugin update runs the new code while the old instance is still
  // alive. Forcing a higher version would block on those connections forever.
  it("opens promptly while an older instance still holds a v1 connection, without upgrading", async () => {
    const name = freshName("blocked");
    const oldInstance = await openV1(name);
    await oldInstance.put("mailboxes", { key: "a1/INBOX", accountId: "a1", id: "INBOX", name: "Inbox", kind: "inbox" });

    const opening = openMailDb(name);
    const result = await settlesWithin(opening, PROMPT_MS);
    try {
      expect(result).not.toBe("timeout");
      const db = result as IDBPDatabase;
      expect(db.version).toBe(1);
      expect(await db.get("mailboxes", "a1/INBOX")).toMatchObject({ name: "Inbox" });
      db.close();
    } finally {
      oldInstance.close();
      // If the open was blocked it settles now; don't leak it into other tests.
      if (result === "timeout") (await opening).close();
    }
  });

  it("opens an existing v2 database (from an earlier branch build) without a VersionError", async () => {
    const name = freshName("v2");
    const v2 = await openV2WithContacts(name);
    await v2.put("mailboxes", { key: "a1/INBOX", accountId: "a1", id: "INBOX", name: "Inbox", kind: "inbox" });
    v2.close();

    const db = await openMailDb(name);
    expect(db.version).toBe(2);
    expect(await db.get("mailboxes", "a1/INBOX")).toMatchObject({ name: "Inbox" });
    db.close();
  });

  it("creates the mail stores at version 1 on a fresh database", async () => {
    const db = await openMailDb(freshName("fresh"));
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames].sort()).toEqual(["bodies", "cursors", "mailboxes", "messages", "meta"]);
    expect(db.transaction("messages").store.indexNames.contains("by-account-thread")).toBe(true);
    db.close();
  });

  it("closes its own connection when a newer version needs to upgrade (blocking)", async () => {
    const name = freshName("blocking");
    const ours = await openMailDb(name);

    let blocked = false;
    const v3 = await openDB(name, 3, {
      upgrade(db) { db.createObjectStore("v3only"); },
      blocked() { blocked = true; },
    });

    expect(blocked).toBe(false);
    expect(v3.version).toBe(3);
    // Our connection closed itself, so any further use throws.
    expect(() => ours.transaction("messages")).toThrow();
    v3.close();
  });
});
