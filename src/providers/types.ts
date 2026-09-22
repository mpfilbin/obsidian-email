export type ProviderKind = "ms-graph";

export interface Address {
  name?: string;
  email: string;
}

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  /** Base64-encoded file content. */
  contentBytes: string;
}

export interface OutgoingMessage {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyHtml: string;
  /** Only honored when the message is first created (sendMail / new draft) —
   *  Graph's draft PATCH endpoint doesn't support replacing attachments. */
  attachments?: OutgoingAttachment[];
}

export type MailboxKind =
  | "inbox" | "sent" | "drafts" | "archive" | "trash" | "spam" | "custom";

export interface Mailbox {
  id: string;
  name: string;
  kind: MailboxKind;
  unreadCount?: number;
}

export interface MessageSummary {
  id: string;
  threadId: string;
  mailboxIds: string[];
  from: Address;
  to: Address[];
  cc: Address[];
  /** Only ever populated for messages the account itself composed (drafts and
   *  sent items); absent for received mail and for rows cached before this
   *  field existed, so treat `undefined` as "none". */
  bcc?: Address[];
  subject: string;
  snippet: string;
  date: number; // epoch ms
  unread: boolean;
  hasAttachments: boolean;
  flagged: boolean;
}

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  inline: boolean;
  contentId?: string;
}

export interface MessageBody {
  id: string;
  html: string | null;
  text: string | null;
  attachments: AttachmentMeta[];
  headers: Record<string, string>;
}

export interface Page<T> {
  items: T[];
  nextPageToken?: string;
}

export type SyncCursor = { kind: "ms-graph"; deltaLinks: Record<string, string> };

/** A sync-time update to a cached message. `id` and `mailboxIds` are always
 *  present; every other field is included only when the provider actually
 *  has a fresh value for it. Microsoft Graph's mail delta endpoint can
 *  report a metadata-only change (e.g. read/flag status) as a payload
 *  containing just `id` plus the changed property — omitting `subject`,
 *  `from`, etc. even though they're in `$select` — so the cache must treat
 *  an absent field here as "unchanged", never as "now blank". */
export type MessageSummaryPatch = { id: string; mailboxIds: string[] } & Partial<Omit<MessageSummary, "id" | "mailboxIds">>;

export interface SyncResult {
  upserts: MessageSummaryPatch[];
  deletions: string[];
  mailboxChanges: Mailbox[];
  cursor: SyncCursor;
}

export interface MailProvider {
  readonly kind: ProviderKind;
  listMailboxes(): Promise<Mailbox[]>;
  /** Creates a new top-level custom folder (mailbox). */
  createMailbox(name: string): Promise<Mailbox>;
  /** Renames an existing folder. */
  renameMailbox(id: string, name: string): Promise<Mailbox>;
  /** Permanently deletes a folder and everything in it — Graph has no
   *  soft-delete for folders the way it does for messages. */
  deleteMailbox(id: string): Promise<void>;
  listMessages(mailboxId: string, pageToken?: string): Promise<Page<MessageSummary>>;
  getMessageBody(id: string): Promise<MessageBody>;
  getAttachment(messageId: string, attachmentId: string): Promise<ArrayBuffer>;
  search(query: string, pageToken?: string): Promise<Page<MessageSummary>>;
  initialCursor(): Promise<SyncCursor>;
  syncSince(cursor: SyncCursor): Promise<SyncResult>;

  /** POST /me/sendMail. Sends immediately; no server-side draft is created. */
  sendNewMessage(msg: OutgoingMessage): Promise<void>;

  /** POST /me/messages/{id}/reply or /replyAll. `commentHtml` is inlined
   *  above the quoted original; the provider supplies recipients/threading. */
  replyToMessage(id: string, mode: "reply" | "replyAll", commentHtml: string): Promise<void>;

  /** POST /me/messages/{id}/forward. */
  forwardMessage(id: string, commentHtml: string, to: Address[]): Promise<void>;

  /** Creates a draft message; returns its id. */
  createDraft(msg: OutgoingMessage): Promise<string>;

  /** Overwrites an existing draft's fields. */
  updateDraft(id: string, msg: OutgoingMessage): Promise<void>;

  /** Sends an existing draft as-is. Caller must `updateDraft` first if the
   *  user edited since the last save. */
  sendDraft(id: string): Promise<void>;

  /** Permanently deletes a draft. */
  deleteDraft(id: string): Promise<void>;

  /** DELETE /me/messages/{id}. Graph moves the message to Deleted Items from
   *  any other folder, and permanently deletes it if it's already in Deleted
   *  Items — there is no client-side soft/permanent distinction here; Graph's
   *  own server-side behavior handles it based on the message's current folder. */
  deleteMessage(id: string): Promise<void>;

  /** Moves a message to the Archive well-known folder. */
  archiveMessage(id: string): Promise<void>;

  /** Moves a message to an arbitrary mailbox (by its Mailbox.id). */
  moveMessage(id: string, destinationMailboxId: string): Promise<void>;

  /** Sets or clears the follow-up flag on one message. Only flagged /
   *  not-flagged are modelled: Outlook's "completed" state reads as not
   *  flagged, and clearing writes `notFlagged`. */
  setMessageFlag(id: string, flagged: boolean): Promise<void>;

  /** Every flagged message across folders (the caller excludes Trash/Junk).
   *  Unlike `search`, items carry their real `mailboxIds` so they can be
   *  cached. Paged; pass the previous page's `nextPageToken`. */
  listFlaggedMessages(pageToken?: string): Promise<Page<MessageSummary>>;
}

/** A contact in the user's address book. Only the fields the plugin edits are
 *  modelled; Graph fields not listed here are never sent, so saving a contact
 *  can't clobber them. */
export interface Contact {
  id: string;
  displayName: string;
  givenName?: string;
  surname?: string;
  emails: Address[];
  mobilePhone?: string;
  businessPhones: string[];
  homePhones: string[];
  companyName?: string;
  jobTitle?: string;
  notes?: string;
}
export type ContactDraft = Omit<Contact, "id">;
/** For an update: only the keys present are sent. `""` clears a string field. */
export type ContactPatch = Partial<ContactDraft>;

export interface ContactsProvider {
  /** Every contact in the default Contacts folder (pages internally). */
  listContacts(): Promise<Contact[]>;
  createContact(draft: ContactDraft): Promise<Contact>;
  updateContact(id: string, patch: ContactPatch): Promise<Contact>;
  /** Resolves (rather than throws) if the contact is already gone. */
  deleteContact(id: string): Promise<void>;
}

export function supportsContacts<T extends object>(p: T | undefined | null): p is T & ContactsProvider {
  return !!p && typeof (p as Partial<ContactsProvider>).listContacts === "function";
}

/** Thrown by contacts calls when the account's token lacks `Contacts.ReadWrite`
 *  (Graph answers 403). Distinct from `AuthError` so it never flags the mail
 *  account as needing re-authentication. */
export class ContactsConsentRequired extends Error {
  constructor(message = "Contacts access has not been granted for this account.") {
    super(message);
    this.name = "ContactsConsentRequired";
  }
}

/** Thrown when the account must re-authenticate (refresh failed / revoked). */
export class AuthError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AuthError";
  }
}

/** Thrown for transient provider/network failures worth retrying later. */
export class ProviderError extends Error {
  /** Provider-specific error code from the response body, when one was given. */
  code?: string;
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * Thrown by `syncSince` when the stored cursor is too old for the provider to
 * diff from (Graph delta 410 `resyncRequired`).
 *
 * This is recoverable, not an error state: the SyncEngine drops the cursor and
 * re-runs a backfill rather than leaving the account permanently stuck.
 */
export class CursorExpiredError extends Error {
  constructor(message = "sync cursor expired", readonly cause?: unknown) {
    super(message);
    this.name = "CursorExpiredError";
  }
}
