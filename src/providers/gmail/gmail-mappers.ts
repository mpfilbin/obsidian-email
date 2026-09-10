import type { Address, AttachmentMeta, Mailbox, MailboxKind, MessageBody, MessageSummary } from "../types";

export interface GmailHeader { name: string; value: string; }
export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
}
export interface GmailLabel { id: string; name: string; type?: string; }

export const GMAIL_ARCHIVE_MAILBOX: Mailbox = { id: "ARCHIVE", name: "All Mail", kind: "archive" };

export function decodeBase64UrlBytes(data: string): Uint8Array {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(data.length / 4) * 4, "=");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function decodeBase64Url(data: string): string {
  return new TextDecoder("utf-8").decode(decodeBase64UrlBytes(data));
}

export function parseAddress(raw: string): Address {
  const t = raw.trim();
  const m = t.match(/^\s*(?:"?([^"<]*?)"?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim();
    return name ? { name, email: m[2].trim() } : { email: m[2].trim() };
  }
  return { email: t.replace(/^<|>$/g, "") };
}

export function parseAddressList(raw: string | undefined): Address[] {
  if (!raw) return [];
  const parts: string[] = [];
  let buf = "";
  let inQuote = false;
  for (const ch of raw) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === "," && !inQuote) { parts.push(buf); buf = ""; }
    else buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  return parts.map((p) => parseAddress(p)).filter((a) => a.email);
}

export function headerMap(headers: GmailHeader[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) out[h.name.toLowerCase()] = h.value;
  return out;
}

const SYSTEM_LABEL_KIND: Record<string, MailboxKind> = {
  INBOX: "inbox", SENT: "sent", TRASH: "trash", SPAM: "spam", DRAFT: "drafts",
};
const HIDDEN_LABELS = new Set([
  "UNREAD", "STARRED", "IMPORTANT", "CHAT",
  "CATEGORY_PERSONAL", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES", "CATEGORY_FORUMS",
]);

function summaryMailboxIds(labelIds: string[]): string[] {
  const visible = labelIds.filter((id) => !HIDDEN_LABELS.has(id));
  return visible.length ? visible : [GMAIL_ARCHIVE_MAILBOX.id];
}

export function mapGmailSummary(msg: GmailMessage): MessageSummary {
  const h = headerMap(msg.payload?.headers);
  const labels = msg.labelIds ?? [];
  return {
    id: msg.id,
    threadId: msg.threadId,
    mailboxIds: summaryMailboxIds(labels),
    from: parseAddress(h.from ?? ""),
    to: parseAddressList(h.to),
    cc: parseAddressList(h.cc),
    subject: h.subject ?? "(no subject)",
    snippet: msg.snippet ?? "",
    date: h.date ? Date.parse(h.date) : Date.now(),
    unread: labels.includes("UNREAD"),
    hasAttachments: hasAttachmentPart(msg.payload),
    flagged: labels.includes("STARRED"),
  };
}

function hasAttachmentPart(part?: GmailPart): boolean {
  if (!part) return false;
  if (part.filename && part.body?.attachmentId) return true;
  return (part.parts ?? []).some(hasAttachmentPart);
}

function walkParts(part: GmailPart, acc: { html?: string; text?: string; attachments: AttachmentMeta[] }): void {
  const mime = part.mimeType ?? "";
  if (part.filename && part.body?.attachmentId) {
    const ph = headerMap(part.headers);
    const disposition = ph["content-disposition"] ?? "";
    const cid = (ph["content-id"] ?? "").replace(/^<|>$/g, "");
    acc.attachments.push({
      id: part.body.attachmentId,
      filename: part.filename,
      mimeType: mime || "application/octet-stream",
      size: part.body.size ?? 0,
      inline: /inline/i.test(disposition) || Boolean(cid),
      contentId: cid || undefined,
    });
    return;
  }
  if (mime === "text/html" && part.body?.data) acc.html = decodeBase64Url(part.body.data);
  else if (mime === "text/plain" && part.body?.data && acc.text === undefined) {
    acc.text = decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) walkParts(child, acc);
}

export function mapGmailBody(msg: GmailMessage): MessageBody {
  const acc: { html?: string; text?: string; attachments: AttachmentMeta[] } = { attachments: [] };
  if (msg.payload) walkParts(msg.payload, acc);
  return {
    id: msg.id,
    html: acc.html ?? null,
    text: acc.text ?? null,
    attachments: acc.attachments,
    headers: headerMap(msg.payload?.headers),
  };
}

export function mapGmailLabels(labels: GmailLabel[]): Mailbox[] {
  const boxes: Mailbox[] = [];
  for (const l of labels) {
    if (HIDDEN_LABELS.has(l.id)) continue;
    const kind = SYSTEM_LABEL_KIND[l.id];
    if (kind) { boxes.push({ id: l.id, name: titleCase(l.id), kind }); continue; }
    if (l.type === "system") continue; // other system labels not surfaced
    boxes.push({ id: l.id, name: l.name, kind: "custom" });
  }
  boxes.push(GMAIL_ARCHIVE_MAILBOX);
  return boxes;
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
