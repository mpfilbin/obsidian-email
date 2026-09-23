import type { Address, MessageBody, MessageSummary } from "../providers/types";
import { escapeHtml } from "./message-renderer";
import { sanitizeEmailHtml } from "./html-sanitizer";

const fmtAddr = (a: Address): string =>
  a.name ? `${escapeHtml(a.name)} &lt;${escapeHtml(a.email)}&gt;` : escapeHtml(a.email);

/** Renders a message as a standalone HTML document suitable for `window.print()`:
 *  a From/To/Cc/Date header block, then the sanitized body, then a list of
 *  non-inline attachment filenames. Like `emailToNote`, this re-sanitizes
 *  `body.html` rather than reusing the live-rendered DOM, so inline (cid:)
 *  images won't appear — the same accepted gap as "Save email to vault".
 *  `allowRemote` mirrors the reading pane's own remote-content gate, so
 *  printing doesn't silently fetch tracking pixels the user has blocked. */
export function messageToPrintHtml(
  summary: MessageSummary,
  body: MessageBody,
  opts: { allowRemote: boolean },
): string {
  const subject = summary.subject || "(no subject)";
  const bodyHtml = body.html
    ? sanitizeEmailHtml(body.html, { allowRemote: opts.allowRemote }).html
    : `<pre>${escapeHtml(body.text ?? "")}</pre>`;

  const attachments = body.attachments.filter((a) => !a.inline);
  const attachmentsHtml = attachments.length
    ? `<div class="attachments"><strong>Attachments:</strong> ${attachments.map((a) => escapeHtml(a.filename)).join(", ")}</div>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(subject)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #000; }
  h1 { font-size: 1.4rem; margin: 0 0 0.75rem; }
  .header { font-size: 0.9rem; line-height: 1.5; margin-bottom: 1rem; }
  hr { border: none; border-top: 1px solid #ccc; margin: 1rem 0; }
  .attachments { margin-top: 1.5rem; font-size: 0.9rem; }
</style>
</head>
<body>
<h1>${escapeHtml(subject)}</h1>
<div class="header">
<div>From: ${fmtAddr(summary.from)}</div>
${summary.to.length ? `<div>To: ${summary.to.map(fmtAddr).join(", ")}</div>` : ""}
${summary.cc.length ? `<div>Cc: ${summary.cc.map(fmtAddr).join(", ")}</div>` : ""}
<div>Date: ${escapeHtml(new Date(summary.date).toLocaleString())}</div>
</div>
<hr>
${bodyHtml}
${attachmentsHtml}
</body>
</html>
`;
}
