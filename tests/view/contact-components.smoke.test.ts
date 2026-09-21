import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import AddressBook from "../../src/view/components/AddressBook.svelte";
import ContactList from "../../src/view/components/ContactList.svelte";
import ContactDetail from "../../src/view/components/ContactDetail.svelte";
import ContactForm from "../../src/view/components/ContactForm.svelte";
import ContactPane from "../../src/view/components/ContactPane.svelte";
import ContactFormHost from "./fixtures/ContactFormHost.svelte";
import ContactPaneHost from "./fixtures/ContactPaneHost.svelte";
import { draftFromContact, emptyDraft } from "../../src/view/contact-draft";
import type { Contact } from "../../src/providers/types";
import type { ContactEditState } from "../../src/view/view-model";

const ada: Contact = {
  id: "C1", displayName: "Ada Lovelace", givenName: "Ada", surname: "Lovelace",
  emails: [{ email: "ada@x.com" }, { email: "ada.home@x.com" }], mobilePhone: "555-0100",
  businessPhones: ["555-0101"], homePhones: [], companyName: "Engines", jobTitle: "Countess", notes: "Line one\nLine two",
};
const bob: Contact = { id: "C2", displayName: "Bob", emails: [], businessPhones: [], homePhones: [] };

const mountIn = (Comp: unknown, props: Record<string, unknown>) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = mount(Comp as never, { target: host, props });
  flushSync();
  return { host, done: () => { unmount(app); host.remove(); } };
};
const q = <T extends HTMLElement = HTMLElement>(host: HTMLElement, sel: string) => host.querySelector<T>(sel);

describe("AddressBook", () => {
  it("shows All contacts with the count", () => {
    const { host, done } = mountIn(AddressBook, { count: 12, status: "idle", onGrant: vi.fn() });
    expect(host.textContent).toContain("All contacts");
    expect(q(host, ".oe-count")!.textContent).toBe("12");
    expect(q(host, ".oe-grant-contacts")).toBeNull();
    done();
  });

  for (const status of ["needs-consent", "needs-reauth"] as const) {
    it(`${status} shows the grant button, which calls onGrant`, () => {
      const onGrant = vi.fn();
      const { host, done } = mountIn(AddressBook, { count: 0, status, onGrant });
      q(host, ".oe-grant-contacts")!.click();
      expect(onGrant).toHaveBeenCalledOnce();
      done();
    });
  }

  it("needs-consent explains the missing grant; needs-reauth explains the failed sign-in and offers re-authentication", () => {
    const a = mountIn(AddressBook, { count: 0, status: "needs-consent", onGrant: vi.fn() });
    expect(a.host.textContent).toMatch(/hasn't been granted/i);
    expect(q(a.host, ".oe-grant-contacts")!.textContent).toBe("Grant contacts access");
    a.done();
    const b = mountIn(AddressBook, { count: 0, status: "needs-reauth", onGrant: vi.fn() });
    expect(b.host.textContent).not.toMatch(/hasn't been granted/i);
    expect(b.host.textContent).toMatch(/sign(ing)? in/i);
    expect(q(b.host, ".oe-grant-contacts")!.textContent).toBe("Re-authenticate");
    b.done();
  });

  it("disables the grant button while the OAuth flow is pending", async () => {
    let release!: () => void;
    const onGrant = vi.fn(() => new Promise<void>((res) => { release = res; }));
    const { host, done } = mountIn(AddressBook, { count: 0, status: "needs-consent", onGrant });
    const button = q<HTMLButtonElement>(host, ".oe-grant-contacts")!;

    button.click();
    flushSync();
    expect(button.disabled).toBe(true);

    // A second click while pending must not start a second OAuth flow.
    button.click();
    flushSync();
    expect(onGrant).toHaveBeenCalledOnce();

    release();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(button.disabled).toBe(false);
    done();
  });

  it("re-enables the grant button when the OAuth flow rejects", async () => {
    const onGrant = vi.fn(() => Promise.reject(new Error("user cancelled")));
    const { host, done } = mountIn(AddressBook, { count: 0, status: "needs-reauth", onGrant });
    const button = q<HTMLButtonElement>(host, ".oe-grant-contacts")!;

    button.click();
    flushSync();
    expect(button.disabled).toBe(true);

    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(button.disabled).toBe(false);
    done();
  });

  it("error shows a message and no grant button", () => {
    const { host, done } = mountIn(AddressBook, { count: 0, status: "error", onGrant: vi.fn() });

    expect(host.textContent).toMatch(/couldn't load contacts/i);
    expect(q(host, ".oe-grant-contacts")).toBeNull();
    done();
  });
});

describe("ContactList", () => {
  const base = { contacts: [ada, bob], selectedId: "C2", search: "", hasAny: true, loading: false, onSearch: vi.fn(), onSelect: vi.fn() };

  it("renders a row per contact with name and primary email, marking the selected one", () => {
    const { host, done } = mountIn(ContactList, base);
    const rows = [...host.querySelectorAll(".oe-contact-row")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Ada Lovelace");
    expect(rows[0].textContent).toContain("ada@x.com");
    expect(rows[1].classList.contains("is-active")).toBe(true);
    done();
  });

  it("clicking a row selects it; typing in search reports the query", () => {
    const onSelect = vi.fn();
    const onSearch = vi.fn();
    const { host, done } = mountIn(ContactList, { ...base, onSelect, onSearch });
    (host.querySelectorAll(".oe-contact-row")[0] as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith("C1");
    const input = q<HTMLInputElement>(host, 'input[data-field="contact-search"]')!;
    input.value = "ada";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onSearch).toHaveBeenCalledWith("ada");
    done();
  });

  it("distinguishes 'no contacts' from 'no matches', and shows loading", () => {
    const empty = mountIn(ContactList, { ...base, contacts: [], hasAny: false });
    expect(empty.host.textContent).toContain("No contacts");
    empty.done();
    const none = mountIn(ContactList, { ...base, contacts: [], hasAny: true, search: "zz" });
    expect(none.host.textContent).toMatch(/no matching contacts/i);
    none.done();
    const loading = mountIn(ContactList, { ...base, contacts: [], hasAny: false, loading: true });
    expect(loading.host.textContent).not.toContain("No contacts");
    loading.done();
  });
});

describe("ContactDetail", () => {
  it("shows the populated fields, each email as a button, and preserves note line breaks", () => {
    const { host, done } = mountIn(ContactDetail, { contact: ada, onEmail: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() });
    expect(host.textContent).toContain("Ada Lovelace");
    expect(host.textContent).toContain("Countess");
    expect(host.textContent).toContain("Engines");
    expect(host.textContent).toContain("555-0100");
    expect(host.textContent).toContain("555-0101");
    expect(host.querySelectorAll(".oe-contact-email")).toHaveLength(2);
    expect(q(host, ".oe-contact-notes")!.textContent).toBe("Line one\nLine two");
    done();
  });

  it("renders duplicate emails and phones without key collisions", () => {
    const dup: Contact = { ...bob, emails: [{ email: "d@x.com" }, { email: "d@x.com" }], businessPhones: ["1", "1"] };
    const { host, done } = mountIn(ContactDetail, { contact: dup, onEmail: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() });
    expect(host.querySelectorAll(".oe-contact-email")).toHaveLength(2);
    expect(host.querySelectorAll(".oe-contact-fields dd")).toHaveLength(3);
    done();
  });

  it("omits empty sections", () => {
    const { host, done } = mountIn(ContactDetail, { contact: bob, onEmail: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() });
    expect(host.querySelectorAll(".oe-contact-email")).toHaveLength(0);
    expect(q(host, ".oe-contact-notes")).toBeNull();
    done();
  });

  it("readOnly disables Edit and Delete but leaves the email links working", () => {
    const onEmail = vi.fn(); const onEdit = vi.fn(); const onDelete = vi.fn();
    const { host, done } = mountIn(ContactDetail, { contact: ada, readOnly: true, onEmail, onEdit, onDelete });
    expect(q<HTMLButtonElement>(host, ".oe-contact-edit")!.disabled).toBe(true);
    expect(q<HTMLButtonElement>(host, ".oe-contact-delete")!.disabled).toBe(true);
    q(host, ".oe-contact-edit")!.click();
    q(host, ".oe-contact-delete")!.click();
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    (host.querySelectorAll(".oe-contact-email")[0] as HTMLElement).click();
    expect(onEmail).toHaveBeenCalledWith("ada@x.com");
    done();
  });

  it("email, edit and delete controls call back", () => {
    const onEmail = vi.fn(); const onEdit = vi.fn(); const onDelete = vi.fn();
    const { host, done } = mountIn(ContactDetail, { contact: ada, onEmail, onEdit, onDelete });
    (host.querySelectorAll(".oe-contact-email")[1] as HTMLElement).click();
    expect(onEmail).toHaveBeenCalledWith("ada.home@x.com");
    q(host, ".oe-contact-edit")!.click();
    q(host, ".oe-contact-delete")!.click();
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
    done();
  });
});

describe("ContactForm", () => {
  const editState = (over: Partial<ContactEditState> = {}): ContactEditState => ({
    mode: "edit", seq: 1, contactId: "C1", draft: draftFromContact(ada), saved: draftFromContact(ada), error: null, saving: false, ...over,
  });
  const field = (host: HTMLElement, name: string) => q<HTMLInputElement>(host, `[data-field="contact-${name}"]`)!;
  const change = (el: HTMLInputElement | HTMLTextAreaElement, value: string, evt: "input" | "change") => {
    el.value = value;
    el.dispatchEvent(new Event(evt, { bubbles: true }));
    flushSync();
  };
  const props = (over: Record<string, unknown> = {}) => ({ edit: editState(), onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), ...over });

  it("is prefilled from the draft", () => {
    const { host, done } = mountIn(ContactForm, props());
    expect(field(host, "displayName").value).toBe("Ada Lovelace");
    expect(field(host, "givenName").value).toBe("Ada");
    expect(field(host, "emails").value).toBe("ada@x.com, ada.home@x.com");
    expect(field(host, "mobilePhone").value).toBe("555-0100");
    expect(field(host, "businessPhones").value).toBe("555-0101");
    expect(field(host, "companyName").value).toBe("Engines");
    expect((field(host, "notes") as unknown as HTMLTextAreaElement).value).toBe("Line one\nLine two");
    done();
  });

  it("text fields report changes as they are typed", () => {
    const onChange = vi.fn();
    const { host, done } = mountIn(ContactForm, props({ onChange }));
    change(field(host, "givenName"), "Augusta", "input");
    expect(onChange).toHaveBeenLastCalledWith({ givenName: "Augusta" });
    change(field(host, "jobTitle"), "Analyst", "input");
    expect(onChange).toHaveBeenLastCalledWith({ jobTitle: "Analyst" });
    change(field(host, "notes") as unknown as HTMLInputElement, "hi", "input");
    expect(onChange).toHaveBeenLastCalledWith({ notes: "hi" });
    done();
  });

  it("emails and phone lists are parsed on change", () => {
    const onChange = vi.fn();
    const { host, done } = mountIn(ContactForm, props({ onChange }));
    change(field(host, "emails"), "a@x.com, b@y.com", "change");
    expect(onChange).toHaveBeenLastCalledWith({ emails: [{ email: "a@x.com" }, { email: "b@y.com" }] });
    change(field(host, "homePhones"), "1, 2", "change");
    expect(onChange).toHaveBeenLastCalledWith({ homePhones: ["1", "2"] });
    done();
  });

  it("an email entry without '@' is rejected with a warning and not committed", () => {
    const onChange = vi.fn();
    const { host, done } = mountIn(ContactForm, props({ onChange }));
    change(field(host, "emails"), "not-an-address", "change");
    expect(onChange).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/missing an "@"/i);
    done();
  });

  it("Save and Cancel call back; Save is disabled while saving; an error is shown", () => {
    const onSave = vi.fn(); const onCancel = vi.fn();
    const a = mountIn(ContactForm, props({ onSave, onCancel, edit: editState({ error: "Enter a name or an email address." }) }));
    q(a.host, ".oe-contact-save")!.click();
    q(a.host, ".oe-contact-cancel")!.click();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(q(a.host, ".oe-contact-form-error")!.textContent).toContain("Enter a name");
    a.done();
    const b = mountIn(ContactForm, props({ edit: editState({ saving: true }) }));
    expect(q<HTMLButtonElement>(b.host, ".oe-contact-save")!.disabled).toBe(true);
    b.done();
  });

  describe("mirror sync across edit replacement", () => {
    const mountHost = (onChange = vi.fn()) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const app = mount(ContactFormHost, { target: host, props: { initial: editState(), onChange } }) as unknown as { set(e: ContactEditState): void };
      flushSync();
      return { host, app, onChange, done: () => { unmount(app as never); host.remove(); } };
    };
    // Same draft contents, brand-new objects: what the view-model does per patch.
    const replaced = (over: Partial<ContactEditState> = {}) => editState({ draft: { ...draftFromContact(ada) }, ...over });

    it("a rejected email keeps its text and warning when edit is replaced with the same emails", () => {
      const { host, app, onChange, done } = mountHost();
      change(field(host, "emails"), "foo", "input"); // typing, then blur
      change(field(host, "emails"), "foo", "change");
      expect(host.textContent).toMatch(/missing an "@"/i);
      expect(field(host, "emails").value).toBe("foo");
      app.set(replaced()); flushSync();
      app.set(replaced({ saving: true })); flushSync();
      expect(field(host, "emails").value).toBe("foo");
      expect(host.textContent).toMatch(/missing an "@"/i);
      expect(onChange).not.toHaveBeenCalled();
      done();
    });

    it("input events on emails / work / home do not commit", () => {
      const onChange = vi.fn();
      const { host, done } = mountHost(onChange);
      change(field(host, "emails"), "a@x.com", "input");
      change(field(host, "businessPhones"), "9", "input");
      change(field(host, "homePhones"), "8", "input");
      expect(onChange).not.toHaveBeenCalled();
      done();
    });

    it("a valid commit clears the warning", () => {
      const { host, done } = mountHost();
      change(field(host, "emails"), "foo", "change");
      expect(host.textContent).toMatch(/missing an "@"/i);
      change(field(host, "emails"), "a@x.com", "change");
      expect(host.textContent).not.toMatch(/missing an "@"/i);
      done();
    });

    it("re-seeds the mirrors (and clears the warning) when the committed values change from outside", () => {
      const { host, app, done } = mountHost();
      change(field(host, "emails"), "foo", "change");
      const other = draftFromContact({ ...ada, emails: [{ email: "z@x.com" }], businessPhones: ["7"], homePhones: ["6", "5"] });
      app.set(editState({ draft: other })); flushSync();
      expect(field(host, "emails").value).toBe("z@x.com");
      expect(field(host, "businessPhones").value).toBe("7");
      expect(field(host, "homePhones").value).toBe("6, 5");
      expect(host.textContent).not.toMatch(/missing an "@"/i);
      done();
    });
  });

  it("a new contact form titles itself accordingly", () => {
    const { host, done } = mountIn(ContactForm, props({ edit: editState({ mode: "new", contactId: undefined, draft: emptyDraft(), saved: emptyDraft() }) }));
    expect(q(host, ".oe-contact-form-title")!.textContent).toBe("New contact");
    done();
  });
});

describe("ContactPane", () => {
  const handlers = { onEmail: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn() };
  const edit: ContactEditState = { mode: "new", seq: 1, draft: emptyDraft(), saved: emptyDraft(), error: null, saving: false };

  it("prompts to select a contact when there is neither a contact nor a form", () => {
    const { host, done } = mountIn(ContactPane, { contact: null, edit: null, ...handlers });
    expect(host.textContent).toContain("Select a contact");
    done();
  });

  it("shows the detail for a contact, and the form (over the detail) while editing", () => {
    const a = mountIn(ContactPane, { contact: ada, edit: null, ...handlers });
    expect(q(a.host, ".oe-contact-detail")).not.toBeNull();
    a.done();
    const b = mountIn(ContactPane, { contact: ada, edit, ...handlers });
    expect(q(b.host, ".oe-contact-form")).not.toBeNull();
    expect(q(b.host, ".oe-contact-detail")).toBeNull();
    b.done();
  });

  it("is the reading-pane column", () => {
    const { host, done } = mountIn(ContactPane, { contact: null, edit: null, ...handlers });
    expect(q(host, "section.oe-reading-pane")).not.toBeNull();
    done();
  });

  it("re-seeds the form when New is used twice in a row", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(ContactPaneHost, {
      target: host,
      props: { contact: null, initial: { ...edit, seq: 1 }, ...handlers },
    }) as unknown as { set(next: ContactEditState): void };
    flushSync();

    // Type an address without committing it (no change event).
    const emails = q<HTMLInputElement>(host, '[data-field="contact-emails"]')!;
    emails.value = "half-typed@x";
    emails.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(q<HTMLInputElement>(host, '[data-field="contact-emails"]')!.value).toBe("half-typed@x");

    // Cancel + New again: mode and contactId are identical, so only `seq`
    // distinguishes the two forms.
    app.set({ ...edit, seq: 2 });
    flushSync();
    expect(q<HTMLInputElement>(host, '[data-field="contact-emails"]')!.value).toBe("");

    unmount(app as never);
    host.remove();
  });
});
