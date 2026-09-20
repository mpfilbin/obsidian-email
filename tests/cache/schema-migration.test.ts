import { describe, it, expect } from "vitest";
import { openDB, type IDBPDatabase } from "idb";
import { openMailDb, DB_VERSION } from "../../src/cache/schema";

function openV1(name: string): Promise<IDBPDatabase> {
  return openDB(name, 1, {
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
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("schema migration", () => {
  it("upgrades a v1 database to v2: adds contacts, keeps existing rows", async () => {
    expect(DB_VERSION).toBe(2);
    const name = `mig-${Date.now()}-${Math.random()}`;
    const v1 = await openV1(name);
    await v1.put("mailboxes", { key: "a1/INBOX", accountId: "a1", id: "INBOX", name: "Inbox", kind: "inbox" });
    v1.close();

    const v2 = await openMailDb(name);
    expect([...v2.objectStoreNames]).toContain("contacts");
    expect(await v2.get("mailboxes", "a1/INBOX")).toMatchObject({ name: "Inbox" });
    expect(v2.transaction("contacts").store.indexNames.contains("by-account")).toBe(true);
    v2.close();
  });

  // Characterisation of the hang this fix wave guards against: a live v1
  // connection (the pre-update plugin instance) blocks the v2 upgrade and the
  // open promise simply never settles — no throw, so no degraded-mode fallback.
  it("stays pending while an older connection blocks the upgrade, then resolves", async () => {
    const name = `blocked-${Date.now()}-${Math.random()}`;
    const v1 = await openV1(name);

    let settled = false;
    const opening = openMailDb(name).then(
      (db) => { settled = true; return db; },
      (err) => { settled = true; throw err; },
    );

    await settle(50);
    expect(settled).toBe(false);

    v1.close();
    const v2 = await opening;
    expect(settled).toBe(true);
    expect([...v2.objectStoreNames]).toContain("contacts");
    v2.close();
  });

  it("closes its own connection when a newer version needs to upgrade (blocking)", async () => {
    const name = `blocking-${Date.now()}-${Math.random()}`;
    const ours = await openMailDb(name);

    let blocked = false;
    const v3 = await openDB(name, 3, {
      upgrade(db) { db.createObjectStore("v3only"); },
      blocked() { blocked = true; },
    });

    expect(blocked).toBe(false);
    expect(v3.version).toBe(3);
    // Our connection closed itself, so any further use throws.
    expect(() => ours.transaction("contacts")).toThrow();
    v3.close();
  });
});
