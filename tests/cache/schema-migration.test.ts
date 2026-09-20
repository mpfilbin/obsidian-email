import { describe, it, expect } from "vitest";
import { openDB } from "idb";
import { openMailDb, DB_VERSION } from "../../src/cache/schema";

describe("schema migration", () => {
  it("upgrades a v1 database to v2: adds contacts, keeps existing rows", async () => {
    expect(DB_VERSION).toBe(2);
    const name = `mig-${Date.now()}-${Math.random()}`;
    const v1 = await openDB(name, 1, {
      upgrade(db) {
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
      },
    });
    await v1.put("mailboxes", { key: "a1/INBOX", accountId: "a1", id: "INBOX", name: "Inbox", kind: "inbox" });
    v1.close();

    const v2 = await openMailDb(name);
    expect([...v2.objectStoreNames]).toContain("contacts");
    expect(await v2.get("mailboxes", "a1/INBOX")).toMatchObject({ name: "Inbox" });
    expect(v2.transaction("contacts").store.indexNames.contains("by-account")).toBe(true);
    v2.close();
  });
});
