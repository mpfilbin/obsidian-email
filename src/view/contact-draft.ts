import type { Address, Contact, ContactDraft, ContactPatch } from "../providers/types";

/** Exchange's per-contact email slot count. Verify against Graph during
 *  implementation (spec "Open items"); the form and validation enforce it. */
export const MAX_CONTACT_EMAILS = 3;

const STRING_FIELDS = ["displayName", "givenName", "surname", "mobilePhone", "companyName", "jobTitle", "notes"] as const;
const LIST_FIELDS = ["businessPhones", "homePhones"] as const;

const norm = (s?: string) => (s ?? "").trim();
const emailKey = (l: Address[]) => l.map((e) => `${e.name ?? ""}<${e.email}>`).join(",");
const listKey = (l: string[]) => l.join("|");

export function emptyDraft(): ContactDraft {
  return { displayName: "", emails: [], businessPhones: [], homePhones: [] };
}

export function draftFromContact(c: Contact): ContactDraft {
  const { id: _id, ...rest } = c;
  return structuredClone(rest);
}

export function sameDraft(a: ContactDraft, b: ContactDraft): boolean {
  return STRING_FIELDS.every((f) => norm(a[f]) === norm(b[f]))
    && LIST_FIELDS.every((f) => listKey(a[f]) === listKey(b[f]))
    && emailKey(a.emails) === emailKey(b.emails);
}

/** Trims, drops blank optionals/list entries, and derives a displayName when
 *  none was typed (given + surname, else the first email). */
export function finalizeDraft(d: ContactDraft): ContactDraft {
  const t = (s?: string) => {
    const v = (s ?? "").trim();
    return v === "" ? undefined : v;
  };
  const list = (l: string[]) => l.map((s) => s.trim()).filter(Boolean);
  const givenName = t(d.givenName);
  const surname = t(d.surname);
  const emails = d.emails
    .filter((e) => e.email.trim())
    .map((e): Address => (e.name ? { name: e.name, email: e.email.trim() } : { email: e.email.trim() }));
  const displayName = t(d.displayName) ?? ([givenName, surname].filter(Boolean).join(" ") || emails[0]?.email || "");
  return {
    displayName, givenName, surname, emails,
    mobilePhone: t(d.mobilePhone),
    businessPhones: list(d.businessPhones),
    homePhones: list(d.homePhones),
    companyName: t(d.companyName),
    jobTitle: t(d.jobTitle),
    notes: t(d.notes),
  };
}

/** `null` when the draft can be saved, else a message for the form. */
export function validateDraft(d: ContactDraft): string | null {
  const f = finalizeDraft(d);
  if (!f.displayName) return "Enter a name or an email address.";
  if (f.emails.length > MAX_CONTACT_EMAILS) return `A contact can have at most ${MAX_CONTACT_EMAILS} email addresses.`;
  return null;
}

/** The fields of `after` that differ from `before` (both already finalized).
 *  A string cleared in `after` becomes `""` so the server clears it too. */
export function patchBetween(before: ContactDraft, after: ContactDraft): ContactPatch {
  const patch: ContactPatch = {};
  for (const f of STRING_FIELDS) {
    if ((before[f] ?? "") !== (after[f] ?? "")) patch[f] = after[f] ?? "";
  }
  for (const f of LIST_FIELDS) {
    if (listKey(before[f]) !== listKey(after[f])) patch[f] = after[f];
  }
  if (emailKey(before.emails) !== emailKey(after.emails)) patch.emails = after.emails;
  return patch;
}

export function sortContacts(list: Contact[]): Contact[] {
  return [...list].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
}

export function primaryEmail(c: Contact): string | undefined {
  return c.emails[0]?.email;
}

export function filterContacts(list: Contact[], query: string): Contact[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) =>
    [c.displayName, c.givenName, c.surname, c.companyName, ...c.emails.map((e) => e.email)]
      .some((s) => s?.toLowerCase().includes(q)),
  );
}
