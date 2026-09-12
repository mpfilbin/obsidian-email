export type ProviderKind = "ms-graph";

export interface Address {
  name?: string;
  email: string;
}

export interface OutgoingMessage {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyHtml: string;
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

export interface SyncResult {
  upserts: MessageSummary[];
  deletions: string[];
  mailboxChanges: Mailbox[];
  cursor: SyncCursor;
}

export interface MailProvider {
  readonly kind: ProviderKind;
  listMailboxes(): Promise<Mailbox[]>;
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
