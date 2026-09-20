import { describe, it, expect } from "vitest";
import {
  MAX_CONTACT_EMAILS, emptyDraft, draftFromContact, sameDraft, finalizeDraft, validateDraft,
  patchBetween, sortContacts, filterContacts, primaryEmail,
} from "../../src/view/contact-draft";
import type { Contact } from "../../src/providers/types";

const ada: Contact = {
  id: "1", displayName: "Ada Lovelace", givenName: "Ada", surname: "Lovelace",
  emails: [{ email: "ada@x.com" }], businessPhones: [], homePhones: [], companyName: "Engines",
};

describe("contact-draft", () => {
  it("draftFromContact drops the id and deep-copies", () => {
    const d = draftFromContact(ada);
    expect("id" in d).toBe(false);
    d.emails.push({ email: "z@x.com" });
    expect(ada.emails).toHaveLength(1);
  });

  it("sameDraft ignores surrounding whitespace on strings", () => {
    expect(sameDraft(draftFromContact(ada), { ...draftFromContact(ada), companyName: "  Engines " })).toBe(true);
    expect(sameDraft(draftFromContact(ada), { ...draftFromContact(ada), jobTitle: "CTO" })).toBe(false);
    expect(sameDraft(draftFromContact(ada), { ...draftFromContact(ada), emails: [{ email: "other@x.com" }] })).toBe(false);
  });

  it("finalizeDraft trims, drops blanks, and derives displayName", () => {
    const f = finalizeDraft({ ...emptyDraft(), givenName: " Ada ", surname: "Byron", jobTitle: "  ", homePhones: [" 1 ", ""] });
    expect(f.displayName).toBe("Ada Byron");
    expect(f.jobTitle).toBeUndefined();
    expect(f.homePhones).toEqual(["1"]);
    expect(finalizeDraft({ ...emptyDraft(), emails: [{ email: " a@x.com " }] }).displayName).toBe("a@x.com");
  });

  it("validateDraft requires a name or an email and caps emails", () => {
    expect(validateDraft(emptyDraft())).toMatch(/name or an email/i);
    expect(validateDraft({ ...emptyDraft(), givenName: "Ada" })).toBeNull();
    expect(validateDraft({ ...emptyDraft(), emails: [{ email: "a@x.com" }] })).toBeNull();
    const many = Array.from({ length: MAX_CONTACT_EMAILS + 1 }, (_, i) => ({ email: `e${i}@x.com` }));
    expect(validateDraft({ ...emptyDraft(), emails: many })).toMatch(/at most/i);
  });

  it("patchBetween returns only changed fields, clearing with empty string", () => {
    const before = draftFromContact(ada);
    expect(patchBetween(before, { ...before })).toEqual({});
    expect(patchBetween(before, { ...before, jobTitle: "CTO" })).toEqual({ jobTitle: "CTO" });
    expect(patchBetween(before, finalizeDraft({ ...before, companyName: "" }))).toEqual({ companyName: "" });
    expect(patchBetween(before, { ...before, homePhones: ["1"] })).toEqual({ homePhones: ["1"] });
    expect(patchBetween(before, { ...before, emails: [{ email: "n@x.com" }] })).toEqual({ emails: [{ email: "n@x.com" }] });
  });

  it("sortContacts orders by displayName case-insensitively, without mutating", () => {
    const list = [{ ...ada, id: "b", displayName: "bob" }, { ...ada, id: "a", displayName: "Alice" }];
    expect(sortContacts(list).map((c) => c.id)).toEqual(["a", "b"]);
    expect(list[0].id).toBe("b");
  });

  it("filterContacts matches name, email and company; empty query keeps all", () => {
    const bob: Contact = { id: "2", displayName: "Bob", emails: [{ email: "bob@corp.io" }], businessPhones: [], homePhones: [] };
    expect(filterContacts([ada, bob], "")).toHaveLength(2);
    expect(filterContacts([ada, bob], "engines").map((c) => c.id)).toEqual(["1"]);
    expect(filterContacts([ada, bob], "CORP.io").map((c) => c.id)).toEqual(["2"]);
    expect(filterContacts([ada, bob], "zzz")).toEqual([]);
  });

  it("primaryEmail is the first address or undefined", () => {
    expect(primaryEmail(ada)).toBe("ada@x.com");
    expect(primaryEmail({ ...ada, emails: [] })).toBeUndefined();
  });
});
