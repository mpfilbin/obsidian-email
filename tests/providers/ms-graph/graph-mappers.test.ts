import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mapGraphSummary, mapGraphBody, mapGraphFolders, toGraphRecipients } from "../../../src/providers/ms-graph/graph-mappers";

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
