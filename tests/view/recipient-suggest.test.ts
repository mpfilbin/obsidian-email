import { describe, it, expect } from "vitest";
import { currentToken, excludedEmails, replaceToken, rankSuggestions } from "../../src/view/recipient-suggest";
import type { Contact } from "../../src/providers/types";

const mk = (id: string, displayName: string, emails: string[], extra: Partial<Contact> = {}): Contact => ({
  id, displayName, emails: emails.map((email) => ({ email })), businessPhones: [], homePhones: [], ...extra,
});

describe("token helpers", () => {
  it("currentToken is the trimmed text after the last comma", () => {
    expect(currentToken("")).toBe("");
    expect(currentToken("ali")).toBe("ali");
    expect(currentToken("a@x.com, bo")).toBe("bo");
    expect(currentToken("a@x.com, ")).toBe("");
  });

  it("excludedEmails lists committed addresses only", () => {
    expect(excludedEmails("a@x.com, b@y.com, al")).toEqual(["a@x.com", "b@y.com"]);
    expect(excludedEmails("al")).toEqual([]);
    expect(excludedEmails("junk, a@x.com, al")).toEqual(["a@x.com"]);
  });

  it("replaceToken swaps the current token for the address plus a separator", () => {
    expect(replaceToken("ali", "alice@x.com")).toBe("alice@x.com, ");
    expect(replaceToken("a@x.com, bo", "bob@y.com")).toBe("a@x.com, bob@y.com, ");
    expect(replaceToken("a@x.com,bo", "bob@y.com")).toBe("a@x.com, bob@y.com, ");
  });
});

describe("rankSuggestions", () => {
  const contacts = [
    // Deliberately NOT in ranked order, so the tests exercise the sort.
    mk("5", "Dale Walters", ["dale@corp.io"]),
    mk("3", "Carol", ["carol@alpha.org"], { givenName: "Carol", surname: "Alvarez" }),
    mk("2", "Bob Alison", ["bob@corp.io", "bob.home@x.com"]),
    mk("1", "Alice Baker", ["alice@corp.io"]),
    mk("4", "No Email", []),
  ];

  it("returns nothing for an empty query", () => {
    expect(rankSuggestions(contacts, "")).toEqual([]);
    expect(rankSuggestions(contacts, "   ")).toEqual([]);
  });

  it("ranks prefix matches before substring matches, then by name", () => {
    const r = rankSuggestions(contacts, "al");
    // Alice, Bob Alison and Carol Alvarez all have a word starting with "al" (score 0), ordered by name;
    // Dale Walters only contains it (score 1) and comes last.
    expect(r.map((s) => s.email)).toEqual(["alice@corp.io", "bob@corp.io", "bob.home@x.com", "carol@alpha.org", "dale@corp.io"]);
  });

  it("matches given/surname and email, case-insensitively", () => {
    expect(rankSuggestions(contacts, "ALVAREZ").map((s) => s.email)).toEqual(["carol@alpha.org"]);
    expect(rankSuggestions(contacts, "corp.io").map((s) => s.email)).toEqual(["alice@corp.io", "bob@corp.io", "dale@corp.io"]);
  });

  it("yields one row per address and carries the contact's name", () => {
    const r = rankSuggestions(contacts, "bob");
    expect(r).toEqual([{ name: "Bob Alison", email: "bob@corp.io" }, { name: "Bob Alison", email: "bob.home@x.com" }]);
  });

  it("skips excluded addresses (case-insensitive) and honours the limit", () => {
    expect(rankSuggestions(contacts, "bob", ["BOB@corp.io"]).map((s) => s.email)).toEqual(["bob.home@x.com"]);
    expect(rankSuggestions(contacts, "al", [], 2).map((s) => s.email)).toEqual(["alice@corp.io", "bob@corp.io"]);
  });

  it("dedupes by address case-insensitively, keeping the best-scored row", () => {
    const dupes = [
      mk("D1", "Joann Lee", ["shared@x.com"]),          // substring match only (score 1)
      mk("D2", "Ann Shared", ["SHARED@x.com", "shared@x.com"]), // prefix match (score 0), listed twice
      mk("D3", "Bob", ["bob@x.com"]),
    ];
    expect(rankSuggestions(dupes, "ann")).toEqual([{ name: "Ann Shared", email: "SHARED@x.com" }]);
    expect(rankSuggestions(dupes, "x.com").map((s) => s.email.toLowerCase())).toEqual(["shared@x.com", "bob@x.com"]);
  });

  it("skips contacts with no email", () => {
    expect(rankSuggestions(contacts, "no email")).toEqual([]);
  });
});
