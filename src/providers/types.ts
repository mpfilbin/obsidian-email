export type ProviderKind = "gmail" | "ms-graph";

export interface Address {
  name?: string;
  email: string;
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

export type SyncCursor =
  | { kind: "gmail"; historyId: string }
  | { kind: "ms-graph"; deltaLinks: Record<string, string> };

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
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = "ProviderError";
  }
}
