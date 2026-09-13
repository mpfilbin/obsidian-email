import { describe, it, expect } from "vitest";
import { defaultNoteFilename, emailToNote } from "../../src/render/email-to-note";
import type { MessageBody, MessageSummary } from "../../src/providers/types";

function summary(over: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: "m1", threadId: "t1", mailboxIds: ["INBOX"],
    from: { name: "Jane Doe", email: "jane@example.com" },
    to: [{ name: "Michael", email: "me@example.com" }],
    cc: [],
    subject: "Quarterly report",
    snippet: "", date: Date.parse("2026-01-02T03:04:05Z"),
    unread: false, hasAttachments: false, flagged: false,
    ...over,
  };
}

describe("emailToNote", () => {
  it("writes sender/to/cc/subject/received/message_id as frontmatter", () => {
    const note = emailToNote(summary(), { id: "m1", html: "<p>Hello</p>", text: null, attachments: [], headers: {} });
    expect(note).toContain('sender: "Jane Doe <jane@example.com>"');
    expect(note).toContain('to:\n  - "Michael <me@example.com>"');
    expect(note).toContain("cc: []");
    expect(note).toContain('subject: "Quarterly report"');
    expect(note).toContain("received: 2026-01-02T03:04:05.000Z");
    expect(note).toContain('message_id: "m1"');
  });

  it("converts the HTML body to Markdown", () => {
    const note = emailToNote(summary(), {
      id: "m1", html: "<h1>Title</h1><p>Some <b>bold</b> and a <a href=\"https://x.com\">link</a>.</p>",
      text: null, attachments: [], headers: {},
    });
    expect(note).toContain("# Title");
    expect(note).toContain("**bold**");
    // The sanitizer adds a `title=<href>` anti-phishing hover-hint to every
    // link, which Turndown renders as this title suffix — expected, not a bug.
    expect(note).toContain('[link](https://x.com "https://x.com")');
  });

  it("falls back to plain text when there is no HTML body", () => {
    const note = emailToNote(summary(), { id: "m1", html: null, text: "Just plain text.", attachments: [], headers: {} });
    expect(note).toContain("Just plain text.");
  });

  it("escapes quotes and colons in the subject/sender without breaking the YAML", () => {
    const note = emailToNote(
      summary({ subject: 'Re: "Q1" review: final', from: { name: 'Jane "JD" Doe', email: "jane@example.com" } }),
      { id: "m1", html: "<p>x</p>", text: null, attachments: [], headers: {} },
    );
    expect(note).toContain('subject: "Re: \\"Q1\\" review: final"');
    expect(note).toContain('sender: "Jane \\"JD\\" Doe <jane@example.com>"');
  });

  it("uses just the email address when the sender has no display name", () => {
    const note = emailToNote(summary({ from: { email: "noreply@example.com" } }), {
      id: "m1", html: "<p>x</p>", text: null, attachments: [], headers: {},
    });
    expect(note).toContain('sender: "noreply@example.com"');
  });
});

describe("defaultNoteFilename", () => {
  it("combines the received date and a sanitized subject", () => {
    expect(defaultNoteFilename(summary())).toBe("2026-01-02 Quarterly report.md");
  });

  it("falls back to 'no subject' when the subject is blank", () => {
    expect(defaultNoteFilename(summary({ subject: "" }))).toBe("2026-01-02 no subject.md");
  });
});
