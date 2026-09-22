import type { Address, AttachmentMeta, Contact, ContactPatch, Mailbox, MailboxKind, MessageBody, MessageSummary, MessageSummaryPatch } from "../types";

interface GraphRecipient { emailAddress?: { name?: string; address?: string }; }
export interface GraphMessage {
  id: string;
  conversationId?: string;
  parentFolderId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  flag?: { flagStatus?: string };
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
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
    // Graph only returns recipients here for messages the account composed
    // (drafts/sent); carried so editing a draft can round-trip its Bcc rather
    // than silently dropping it on the next save.
    bcc: (m.bccRecipients ?? []).map(mapGraphAddress).filter((a) => a.email),
    subject: m.subject || "(no subject)",
    snippet: m.bodyPreview ?? "",
    date: m.receivedDateTime ? Date.parse(m.receivedDateTime) : Date.now(),
    unread: m.isRead === false,
    hasAttachments: Boolean(m.hasAttachments),
    flagged: m.flag?.flagStatus === "flagged",
  };
}

/** Maps a delta item to a patch, including a field only when Graph actually
 *  sent it — see MessageSummaryPatch for why that distinction matters. */
export function mapGraphSummaryPatch(m: GraphMessage, folderId: string): MessageSummaryPatch {
  const patch: MessageSummaryPatch = { id: m.id, mailboxIds: [folderId] };
  if (m.conversationId !== undefined) patch.threadId = m.conversationId;
  if (m.from !== undefined) patch.from = mapGraphAddress(m.from);
  if (m.toRecipients !== undefined) patch.to = m.toRecipients.map(mapGraphAddress).filter((a) => a.email);
  if (m.ccRecipients !== undefined) patch.cc = m.ccRecipients.map(mapGraphAddress).filter((a) => a.email);
  if (m.bccRecipients !== undefined) patch.bcc = m.bccRecipients.map(mapGraphAddress).filter((a) => a.email);
  if (m.subject !== undefined) patch.subject = m.subject || "(no subject)";
  if (m.bodyPreview !== undefined) patch.snippet = m.bodyPreview;
  if (m.receivedDateTime !== undefined) patch.date = Date.parse(m.receivedDateTime);
  if (m.isRead !== undefined) patch.unread = m.isRead === false;
  if (m.hasAttachments !== undefined) patch.hasAttachments = Boolean(m.hasAttachments);
  if (m.flag !== undefined) patch.flagged = m.flag?.flagStatus === "flagged";
  return patch;
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

export interface GraphContact {
  id: string;
  displayName?: string | null;
  givenName?: string | null;
  surname?: string | null;
  emailAddresses?: Array<{ name?: string | null; address?: string | null }>;
  mobilePhone?: string | null;
  businessPhones?: string[];
  homePhones?: string[];
  companyName?: string | null;
  jobTitle?: string | null;
  personalNotes?: string | null;
}

export const CONTACT_SELECT =
  "id,displayName,givenName,surname,emailAddresses,mobilePhone,businessPhones,homePhones,companyName,jobTitle,personalNotes";

export function mapGraphContact(c: GraphContact): Contact {
  // Graph fills a blank recipient name with the address itself; drop that echo.
  const emails = (c.emailAddresses ?? [])
    .filter((e) => e.address)
    .map((e): Address => (e.name && e.name !== e.address ? { name: e.name, email: e.address! } : { email: e.address! }));
  const contact: Contact = {
    id: c.id,
    displayName:
      c.displayName || [c.givenName, c.surname].filter(Boolean).join(" ") || emails[0]?.email || "(no name)",
    emails,
    businessPhones: c.businessPhones ?? [],
    homePhones: c.homePhones ?? [],
  };
  if (c.givenName) contact.givenName = c.givenName;
  if (c.surname) contact.surname = c.surname;
  if (c.mobilePhone) contact.mobilePhone = c.mobilePhone;
  if (c.companyName) contact.companyName = c.companyName;
  if (c.jobTitle) contact.jobTitle = c.jobTitle;
  if (c.personalNotes) contact.notes = c.personalNotes;
  return contact;
}

/** Builds a create/PATCH body containing only the keys present in `p`. */
export function toGraphContact(p: ContactPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (p.displayName !== undefined) body.displayName = p.displayName;
  if (p.givenName !== undefined) body.givenName = p.givenName;
  if (p.surname !== undefined) body.surname = p.surname;
  if (p.emails !== undefined) {
    body.emailAddresses = p.emails.map((e) => ({ address: e.email, name: e.name ?? e.email }));
  }
  if (p.mobilePhone !== undefined) body.mobilePhone = p.mobilePhone;
  if (p.businessPhones !== undefined) body.businessPhones = p.businessPhones;
  if (p.homePhones !== undefined) body.homePhones = p.homePhones;
  if (p.companyName !== undefined) body.companyName = p.companyName;
  if (p.jobTitle !== undefined) body.jobTitle = p.jobTitle;
  if (p.notes !== undefined) body.personalNotes = p.notes;
  return body;
}
