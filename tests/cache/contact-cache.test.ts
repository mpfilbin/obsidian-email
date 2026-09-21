import { describe, it, expect } from "vitest";
import { ContactCache, MemoryContactStore, type ContactStore } from "../../src/cache/contact-cache";
import { MailCache } from "../../src/cache/mail-cache";
import { CONTACT_DB_NAME, CONTACT_DB_VERSION } from "../../src/cache/contact-schema";
import { DB_NAME, DB_VERSION } from "../../src/cache/schema";
import type { Contact } from "../../src/providers/types";

const contact = (id: string, displayName = id): Contact =>
  ({ id, displayName, emails: [{ email: `${id}@x.com` }], businessPhones: [], homePhones: [] });

let n = 0;
const freshName = () => `contact-db-${Date.now()}-${n++}`;

const impls: Array<[string, () => Promise<ContactStore>]> = [
  ["ContactCache", () => ContactCache.open(freshName())],
  ["MemoryContactStore", async () => new MemoryContactStore()],
];

for (const [name, make] of impls) {
  describe(name, () => {
    it("puts and lists contacts sorted by display name, without storage keys", async () => {
      const s = await make();
      await s.put("a1", contact("2", "Bob"));
      await s.put("a1", contact("1", "alice"));
      const list = await s.list("a1");
      expect(list.map((c) => c.displayName)).toEqual(["alice", "Bob"]);
      expect("key" in list[0]).toBe(false);
      expect("accountId" in list[0]).toBe(false);
    });

    it("isolates accounts", async () => {
      const s = await make();
      await s.put("a1", contact("1"));
      await s.put("a2", contact("2"));
      expect((await s.list("a1")).map((c) => c.id)).toEqual(["1"]);
    });

    it("remove deletes one contact", async () => {
      const s = await make();
      await s.put("a1", contact("1"));
      await s.put("a1", contact("2"));
      await s.remove("a1", "1");
      expect((await s.list("a1")).map((c) => c.id)).toEqual(["2"]);
    });

    it("replace upserts the new set and drops contacts missing from it", async () => {
      const s = await make();
      await s.put("a1", contact("1"));
      await s.put("a1", contact("2"));
      await s.put("a2", contact("9"));
      await s.replace("a1", [contact("2", "Renamed"), contact("3")]);
      expect((await s.list("a1")).map((c) => c.displayName).sort()).toEqual(["3", "Renamed"]);
      expect((await s.list("a2")).map((c) => c.id)).toEqual(["9"]);
    });

    it("clearAll empties every account", async () => {
      const s = await make();
      await s.put("a1", contact("1"));
      await s.put("a2", contact("2"));
      await s.clearAll();
      expect(await s.list("a1")).toEqual([]);
      expect(await s.list("a2")).toEqual([]);
    });

    it("clear removes only that account's contacts", async () => {
      const s = await make();
      await s.put("a1", contact("1"));
      await s.put("a2", contact("2"));
      await s.clear("a1");
      expect(await s.list("a1")).toEqual([]);
      expect((await s.list("a2")).map((c) => c.id)).toEqual(["2"]);
    });
  });
}

describe("ContactCache database", () => {
  it("is independent of the mail database: default names differ and mail clears leave contacts alone", async () => {
    const mail = await MailCache.open();
    const contacts = await ContactCache.open();
    await contacts.put("a1", contact("1"));
    await mail.clearAccount("a1");
    await mail.clearAll();
    expect((await contacts.list("a1")).map((c) => c.id)).toEqual(["1"]);

    const dbs = (await indexedDB.databases()).map((d) => [d.name, d.version]);
    expect(dbs).toContainEqual([DB_NAME, DB_VERSION]);
    expect(dbs).toContainEqual([CONTACT_DB_NAME, CONTACT_DB_VERSION]);
    await contacts.clearAll();
    mail.close();
    contacts.close();
  });

  it("uses its own default database name, distinct from the mail one", () => {
    expect(CONTACT_DB_NAME).toBe("obsidian-email-contacts");
    expect(CONTACT_DB_NAME).not.toBe(DB_NAME);
    expect(CONTACT_DB_VERSION).toBe(1);
  });
});
