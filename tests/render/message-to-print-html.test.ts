import { describe, it, expect } from "vitest";
import { messageToPrintHtml } from "../../src/render/message-to-print-html";
import type { AttachmentMeta, MessageBody, MessageSummary } from "../../src/providers/types";

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

function body(over: Partial<MessageBody> = {}): MessageBody {
  return { id: "m1", html: null, text: null, attachments: [], headers: {}, ...over };
}

function attachment(over: Partial<AttachmentMeta> = {}): AttachmentMeta {
  return { id: "a1", filename: "report.pdf", mimeType: "application/pdf", size: 1024, inline: false, ...over };
}

describe("messageToPrintHtml", () => {
  it("includes the subject as the document title and a heading", () => {
    const html = messageToPrintHtml(summary(), body({ html: "<p>Hi</p>" }));
    expect(html).toContain("<title>Quarterly report</title>");
    expect(html).toContain("<h1>Quarterly report</h1>");
  });

  it("includes a From/To/Cc/Date header block", () => {
    const html = messageToPrintHtml(
      summary({ to: [{ name: "Michael", email: "me@example.com" }], cc: [{ email: "other@example.com" }] }),
      body({ html: "<p>Hi</p>" }),
    );
    expect(html).toContain("Jane Doe &lt;jane@example.com&gt;");
    expect(html).toContain("Michael &lt;me@example.com&gt;");
    expect(html).toContain("other@example.com");
    expect(html).toContain("<div>Date: ");
  });

  it("omits the Cc line when there are no cc recipients", () => {
    const html = messageToPrintHtml(summary({ cc: [] }), body({ html: "<p>Hi</p>" }));
    expect(html).not.toContain("Cc:");
  });

  it("embeds the sanitized HTML body", () => {
    const html = messageToPrintHtml(summary(), body({ html: "<p>Hello <b>world</b></p><script>evil()</script>" }));
    expect(html).toContain("<p>Hello <b>world</b></p>");
    expect(html).not.toContain("evil()");
  });

  it("falls back to escaped plain text when there is no HTML body", () => {
    const html = messageToPrintHtml(summary(), body({ html: null, text: "Just <plain> text." }));
    expect(html).toContain("Just &lt;plain&gt; text.");
  });

  it("lists non-inline attachment filenames, excluding inline ones", () => {
    const html = messageToPrintHtml(
      summary(),
      body({
        html: "<p>Hi</p>",
        attachments: [attachment({ filename: "report.pdf" }), attachment({ id: "a2", filename: "logo.png", inline: true, contentId: "logo" })],
      }),
    );
    expect(html).toContain("report.pdf");
    expect(html).not.toContain("logo.png");
  });

  it("omits the attachments section when there are no attachments to list", () => {
    const html = messageToPrintHtml(summary(), body({ html: "<p>Hi</p>", attachments: [] }));
    expect(html).not.toContain("Attachments:");
  });

  it("escapes special characters in the subject and sender name", () => {
    const html = messageToPrintHtml(
      summary({ subject: "<script>alert(1)</script>", from: { name: "A & B", email: "ab@example.com" } }),
      body({ html: "<p>Hi</p>" }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("A &amp; B &lt;ab@example.com&gt;");
  });
});
