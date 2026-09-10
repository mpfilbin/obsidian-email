import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseAddress, parseAddressList, decodeBase64Url,
  mapGmailSummary, mapGmailBody, mapGmailLabels,
} from "../../../src/providers/gmail/gmail-mappers";

const load = (p: string) => JSON.parse(readFileSync(`tests/fixtures/gmail/${p}`, "utf8"));

describe("gmail address parsing", () => {
  it("parses 'Name <email>'", () => {
    expect(parseAddress("Jane Doe <jane@example.com>")).toEqual({ name: "Jane Doe", email: "jane@example.com" });
  });
  it("parses a bare email", () => {
    expect(parseAddress("bob@example.com")).toEqual({ email: "bob@example.com" });
  });
  it("splits a list on commas outside quotes", () => {
    const list = parseAddressList('"Doe, Jane" <jane@x.com>, bob@y.com');
    expect(list).toEqual([
      { name: "Doe, Jane", email: "jane@x.com" },
      { email: "bob@y.com" },
    ]);
  });
});

describe("decodeBase64Url", () => {
  it("decodes url-safe base64 without padding, utf-8 aware", () => {
    expect(decodeBase64Url("SGVsbG8gd29ybGQ")).toBe("Hello world");
  });
});

describe("mapGmailSummary", () => {
  it("maps metadata to a MessageSummary", () => {
    const m = mapGmailSummary(load("message-metadata.json"));
    expect(m).toMatchObject({
      id: "18f1a", threadId: "18f1a", subject: "Weekly sync",
      from: { name: "Jane Doe", email: "jane@example.com" },
      unread: true, hasAttachments: false, flagged: false,
      mailboxIds: ["INBOX"],
    });
    expect(m.cc).toHaveLength(2);
    expect(m.date).toBe(Date.parse("Wed, 03 Sep 2026 14:05:00 -0700"));
  });
});

describe("mapGmailBody", () => {
  it("prefers text/html, collects attachments, flags inline + contentId", () => {
    const b = mapGmailBody(load("message-full.json"));
    expect(b.html).toBe("<p>Hello</p>");
    expect(b.text).toBe("Hello world");
    expect(b.attachments).toHaveLength(2);
    const pdf = b.attachments.find((a) => a.filename === "report.pdf")!;
    expect(pdf).toMatchObject({ id: "ANGjdJ9", mimeType: "application/pdf", inline: false, size: 12345 });
    const png = b.attachments.find((a) => a.filename === "logo.png")!;
    expect(png).toMatchObject({ inline: true, contentId: "logo123" });
  });
});

describe("mapGmailLabels", () => {
  it("maps system labels to kinds, hides categories, keeps user labels", () => {
    const boxes = mapGmailLabels(load("labels.json").labels);
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    expect(byId.INBOX.kind).toBe("inbox");
    expect(byId.SENT.kind).toBe("sent");
    expect(byId.TRASH.kind).toBe("trash");
    expect(byId.SPAM.kind).toBe("spam");
    expect(byId.DRAFT.kind).toBe("drafts");
    expect(byId.CATEGORY_PROMOTIONS).toBeUndefined();
    expect(byId.Label_12).toMatchObject({ kind: "custom", name: "Projects/Acme" });
  });
});
