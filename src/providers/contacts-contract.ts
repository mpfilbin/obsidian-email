import { describe, it, expect } from "vitest";
import type { ContactDraft, ContactsProvider } from "./types";

const draft = (over: Partial<ContactDraft> = {}): ContactDraft => ({
  displayName: "Ada Lovelace", emails: [{ email: "ada@x.com" }], businessPhones: [], homePhones: [], ...over,
});

export function runContactsProviderContract(name: string, makeProvider: () => Promise<ContactsProvider>): void {
  describe(`${name} — ContactsProvider contract`, () => {
    it("creates a contact and lists it", async () => {
      const p = await makeProvider();
      const created = await p.createContact(draft());
      expect(created.id).toBeTruthy();
      expect(created.displayName).toBe("Ada Lovelace");
      expect((await p.listContacts()).map((c) => c.id)).toContain(created.id);
    });

    it("updates only the patched fields", async () => {
      const p = await makeProvider();
      const created = await p.createContact(draft({ companyName: "Engines" }));
      const updated = await p.updateContact(created.id, { jobTitle: "Countess" });
      expect(updated.jobTitle).toBe("Countess");
      expect(updated.displayName).toBe("Ada Lovelace");
      expect(updated.companyName).toBe("Engines");
      expect(updated.emails).toEqual([{ email: "ada@x.com" }]);
    });

    it("deletes a contact, and deleting one that is gone resolves", async () => {
      const p = await makeProvider();
      const created = await p.createContact(draft());
      await p.deleteContact(created.id);
      expect((await p.listContacts()).map((c) => c.id)).not.toContain(created.id);
      await expect(p.deleteContact(created.id)).resolves.toBeUndefined();
    });
  });
}
