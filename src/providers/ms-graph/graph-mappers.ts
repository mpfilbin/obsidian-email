import type { Address, AttachmentMeta, Mailbox, MailboxKind, MessageBody, MessageSummary } from "../types";

interface GraphRecipient { emailAddress?: { name?: string; address?: string }; }
export interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  flag?: { flagStatus?: string };
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  body?: { contentType?: string; content?: string };
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  attachments?: Array<{
    id: string; name?: string; contentType?: string; size?: number;
    isInline?: boolean; contentId?: string;
  }>;
}
export interface GraphFolder {
  id: string;
  displayName?: string;
  wellKnownName?: string | null;
  unreadItemCount?: number;
}

const WELL_KNOWN_KIND: Record<string, MailboxKind> = {
  inbox: "inbox", sentitems: "sent", drafts: "drafts",
  archive: "archive", deleteditems: "trash", junkemail: "spam",
};

export function mapGraphAddress(r?: GraphRecipient): Address {
  const e = r?.emailAddress ?? {};
  const email = e.address ?? "";
  return e.name ? { name: e.name, email } : { email };
}

export function mapGraphSummary(m: GraphMessage, folderId: string): MessageSummary {
  return {
    id: m.id,
    threadId: m.conversationId ?? m.id,
    mailboxIds: [folderId],
    from: mapGraphAddress(m.from),
    to: (m.toRecipients ?? []).map(mapGraphAddress).filter((a) => a.email),
    cc: (m.ccRecipients ?? []).map(mapGraphAddress).filter((a) => a.email),
    subject: m.subject || "(no subject)",
    snippet: m.bodyPreview ?? "",
    date: m.receivedDateTime ? Date.parse(m.receivedDateTime) : Date.now(),
    unread: m.isRead === false,
    hasAttachments: Boolean(m.hasAttachments),
    flagged: m.flag?.flagStatus === "flagged",
  };
}

export function mapGraphBody(m: GraphMessage): MessageBody {
  const isHtml = (m.body?.contentType ?? "").toLowerCase() === "html";
  const headers: Record<string, string> = {};
  for (const h of m.internetMessageHeaders ?? []) headers[h.name.toLowerCase()] = h.value;
  return {
    id: m.id,
    html: isHtml ? m.body?.content ?? null : null,
    text: !isHtml ? m.body?.content ?? null : null,
    headers,
    attachments: (m.attachments ?? []).map((a): AttachmentMeta => ({
      id: a.id,
      filename: a.name ?? "attachment",
      mimeType: a.contentType ?? "application/octet-stream",
      size: a.size ?? 0,
      inline: Boolean(a.isInline),
      contentId: a.contentId ?? undefined,
    })),
  };
}

export function mapGraphFolders(folders: GraphFolder[]): Mailbox[] {
  return folders.map((f): Mailbox => ({
    id: f.id,
    name: f.displayName ?? f.wellKnownName ?? "Folder",
    kind: WELL_KNOWN_KIND[f.wellKnownName ?? ""] ?? "custom",
    unreadCount: f.unreadItemCount,
  }));
}

export function toGraphRecipients(addresses: Address[]): Array<{ emailAddress: { address: string; name?: string } }> {
  return addresses.map((a) =>
    a.name ? { emailAddress: { address: a.email, name: a.name } } : { emailAddress: { address: a.email } },
  );
}
