import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mapGraphSummary, mapGraphSummaryPatch, mapGraphBody, mapGraphFolders, toGraphRecipients, mapGraphContact, toGraphContact } from "../../../src/providers/ms-graph/graph-mappers";

const fx = (p: string) => JSON.parse(readFileSync(`tests/fixtures/graph/${p}`, "utf8"));

describe("mapGraphSummary", () => {
  it("maps a message to a MessageSummary", () => {
    const m = mapGraphSummary(fx("message.json"), "AAAInbox");
    expect(m).toMatchObject({
      id: "MSG1", threadId: "CONV1", subject: "Quarterly report",
      from: { name: "Jane Doe", email: "jane@example.com" },
      unread: true, hasAttachments: true, flagged: true,
      mailboxIds: ["AAAInbox"],
    });
    expect(m.date).toBe(Date.parse("2026-09-03T21:05:00Z"));
    expect(m.cc[0]).toEqual({ name: "Team", email: "team@example.com" });
  });

  it("carries bccRecipients (drafts/sent items) and defaults to an empty list", () => {
    const src = fx("message.json");
    expect(mapGraphSummary(src, "AAAInbox").bcc).toEqual([]);
    const withBcc = mapGraphSummary(
      { ...src, bccRecipients: [{ emailAddress: { address: "hidden@example.com" } }] },
      "AAADrafts",
    );
    expect(withBcc.bcc).toEqual([{ email: "hidden@example.com" }]);
  });
});

describe("mapGraphSummaryPatch", () => {
  it("maps every field when Graph sends a full record", () => {
    const p = mapGraphSummaryPatch(fx("message.json"), "AAAInbox");
    expect(p).toMatchObject({
      id: "MSG1", threadId: "CONV1", subject: "Quarterly report",
      from: { name: "Jane Doe", email: "jane@example.com" },
      unread: true, hasAttachments: true, flagged: true,
      mailboxIds: ["AAAInbox"],
    });
    expect(p.date).toBe(Date.parse("2026-09-03T21:05:00Z"));
  });

  // Graph's mail delta endpoint can report a metadata-only change (e.g. a
  // read-status toggle) as a payload containing just `id` plus the changed
  // property, omitting subject/from/etc. entirely even though `$select`
  // lists them. The patch must reflect that omission rather than papering
  // over it with "(no subject)"/blank defaults — those defaults are only
  // for a message the cache has genuinely never seen before (see
  // MailCache.patchMessages).
  it("omits fields Graph didn't include in a metadata-only delta item", () => {
    const p = mapGraphSummaryPatch({ id: "MSG1", isRead: true }, "AAAInbox");
    expect(p).toEqual({ id: "MSG1", mailboxIds: ["AAAInbox"], unread: false });
  });

  it("still falls back to '(no subject)' when subject is present but empty", () => {
    const p = mapGraphSummaryPatch({ id: "MSG1", subject: "" }, "AAAInbox");
    expect(p.subject).toBe("(no subject)");
  });
});

describe("mapGraphBody", () => {
  it("maps html body, headers and attachments with inline flag", () => {
    const b = mapGraphBody(fx("message-full.json"));
    expect(b.html).toBe("<p>Hello <b>world</b></p>");
    expect(b.text).toBeNull();
    expect(b.headers["message-id"]).toBe("<abc@ex>");
    expect(b.attachments).toEqual([
      { id: "ATT1", filename: "report.pdf", mimeType: "application/pdf", size: 2048, inline: false, contentId: undefined },
      { id: "ATT2", filename: "logo.png", mimeType: "image/png", size: 512, inline: true, contentId: "logo42" },
    ]);
  });

  it("maps a text body when contentType is text", () => {
    const b = mapGraphBody({ ...fx("message-full.json"), body: { contentType: "text", content: "plain" }, attachments: [] });
    expect(b.text).toBe("plain");
    expect(b.html).toBeNull();
  });
});

describe("mapGraphFolders", () => {
  it("maps well-known names to kinds and unread counts", () => {
    const boxes = mapGraphFolders(fx("folders.json").value);
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    expect(byId.AAAInbox).toMatchObject({ kind: "inbox", name: "Inbox", unreadCount: 3 });
    expect(byId.AAASent.kind).toBe("sent");
    expect(byId.AAADel.kind).toBe("trash");
    expect(byId.AAAJunk.kind).toBe("spam");
    expect(byId.AAAProj.kind).toBe("custom");
  });
});

describe("toGraphRecipients", () => {
  it("maps addresses with and without a display name", () => {
    expect(toGraphRecipients([{ email: "a@x.com" }, { name: "Bea", email: "b@x.com" }])).toEqual([
      { emailAddress: { address: "a@x.com" } },
      { emailAddress: { address: "b@x.com", name: "Bea" } },
    ]);
  });

  it("maps an empty list to an empty array", () => {
    expect(toGraphRecipients([])).toEqual([]);
  });
});

describe("contact mappers", () => {
  it("maps a Graph contact to a Contact", () => {
    const c = mapGraphContact({
      id: "C1", displayName: "Ada Lovelace", givenName: "Ada", surname: "Lovelace",
      emailAddresses: [{ name: "Ada L", address: "ada@x.com" }, { name: "b@x.com", address: "b@x.com" }],
      mobilePhone: "555-0100", businessPhones: ["555-0101"], homePhones: [],
      companyName: "Analytical Engines", jobTitle: "Countess", personalNotes: "hi",
    });
    expect(c).toEqual({
      id: "C1", displayName: "Ada Lovelace", givenName: "Ada", surname: "Lovelace",
      emails: [{ name: "Ada L", email: "ada@x.com" }, { email: "b@x.com" }],
      mobilePhone: "555-0100", businessPhones: ["555-0101"], homePhones: [],
      companyName: "Analytical Engines", jobTitle: "Countess", notes: "hi",
    });
  });

  it("tolerates nulls/missing fields and falls back for displayName", () => {
    const c = mapGraphContact({ id: "C2", displayName: "", givenName: null, surname: null, emailAddresses: [{ address: "z@x.com" }] });
    expect(c.displayName).toBe("z@x.com");
    expect(c.emails).toEqual([{ email: "z@x.com" }]);
    expect(c.businessPhones).toEqual([]);
    expect(c.givenName).toBeUndefined();
  });

  it("toGraphContact includes only the keys present", () => {
    expect(toGraphContact({ jobTitle: "CTO" })).toEqual({ jobTitle: "CTO" });
    expect(toGraphContact({ jobTitle: "" })).toEqual({ jobTitle: "" });
    expect(toGraphContact({ notes: "n", emails: [{ email: "a@x.com" }, { name: "Bo", email: "b@x.com" }] })).toEqual({
      personalNotes: "n",
      emailAddresses: [{ address: "a@x.com", name: "a@x.com" }, { address: "b@x.com", name: "Bo" }],
    });
  });
});
