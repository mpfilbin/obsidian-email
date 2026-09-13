import TurndownService from "turndown";
import type { Address, MessageBody, MessageSummary } from "../providers/types";
import { safeAttachmentName } from "../util/safe-filename";
import { sanitizeEmailHtml } from "./html-sanitizer";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

const fmtAddr = (a: Address): string => (a.name ? `${a.name} <${a.email}>` : a.email);

/** A double-quoted YAML scalar, safe for any string content (colons, quotes,
 *  embedded newlines included) without needing a full YAML library. */
function yamlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

function yamlList(items: string[]): string {
  if (items.length === 0) return " []";
  return `\n${items.map((i) => `  - ${yamlString(i)}`).join("\n")}`;
}

/** Converts an email into a Markdown note with sender/recipients/subject/
 *  received-date/message-id as frontmatter properties. Inline (cid:) images
 *  aren't resolved — they're saved as-is and won't render in the note. */
export function emailToNote(summary: MessageSummary, body: MessageBody): string {
  const bodyMarkdown = body.html
    ? turndown.turndown(sanitizeEmailHtml(body.html, { allowRemote: true }).html)
    : (body.text ?? "");

  const frontmatter = [
    "---",
    `sender: ${yamlString(fmtAddr(summary.from))}`,
    `to:${yamlList(summary.to.map(fmtAddr))}`,
    `cc:${yamlList(summary.cc.map(fmtAddr))}`,
    `subject: ${yamlString(summary.subject)}`,
    `received: ${new Date(summary.date).toISOString()}`,
    `message_id: ${yamlString(summary.id)}`,
    "---",
    "",
  ].join("\n");

  return `${frontmatter}${bodyMarkdown}\n`;
}

/** A vault-relative filename suggestion (no folder) — the user picks/edits
 *  the final path in the save dialog. */
export function defaultNoteFilename(summary: MessageSummary): string {
  const date = new Date(summary.date).toISOString().slice(0, 10);
  const subject = safeAttachmentName(summary.subject || "no subject").slice(0, 100);
  return `${date} ${subject}.md`;
}
