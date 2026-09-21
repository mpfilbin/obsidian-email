import { describe, it, expect } from "vitest";
import { AuthError, ProviderError, supportsContacts, ContactsConsentRequired } from "../../src/providers/types";
import type { MessageSummary, SyncCursor } from "../../src/providers/types";

describe("types", () => {
  it("AuthError and ProviderError carry their fields", () => {
    expect(new AuthError("x").name).toBe("AuthError");
    const p = new ProviderError("y", 503, true);
    expect(p.status).toBe(503);
    expect(p.retryable).toBe(true);
  });

  it("SyncCursor carries per-folder delta links", () => {
    const c: SyncCursor = { kind: "ms-graph", deltaLinks: { INBOX: "d1" } };
    expect(c.kind === "ms-graph" && c.deltaLinks.INBOX).toBe("d1");
  });

  it("MessageSummary is structurally usable", () => {
    const m: MessageSummary = {
      id: "1", threadId: "t1", mailboxIds: ["INBOX"],
      from: { email: "a@b.com" }, to: [], cc: [],
      subject: "hi", snippet: "...", date: 0,
      unread: true, hasAttachments: false, flagged: false,
    };
    expect(m.id).toBe("1");
  });
});

describe("supportsContacts", () => {
  it("is true for an object with listContacts, false otherwise", () => {
    expect(supportsContacts({ listContacts: async () => [] })).toBe(true);
    expect(supportsContacts({})).toBe(false);
    expect(supportsContacts(undefined)).toBe(false);
  });
});

describe("ContactsConsentRequired", () => {
  it("is an Error with its own name", () => {
    const e = new ContactsConsentRequired();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ContactsConsentRequired");
  });
});
