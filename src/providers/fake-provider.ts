import type {
  MailProvider, Mailbox, MessageBody, MessageSummary, Page, SyncCursor, SyncResult, OutgoingMessage, Address,
} from "./types";

type SentLogEntry =
  | { kind: "new"; message: OutgoingMessage }
  | { kind: "reply"; targetId: string; mode: "reply" | "replyAll"; commentHtml: string }
  | { kind: "forward"; targetId: string; commentHtml: string; to: Address[] }
  | { kind: "draft"; draftId: string };

interface Seed {
  mailboxes?: Mailbox[];
  messages?: MessageSummary[];
  bodies?: Record<string, MessageBody>;
}

export class FakeProvider implements MailProvider {
  readonly kind = "ms-graph" as const;
  pageSize = 2;

  private mailboxes: Mailbox[];
  private messages = new Map<string, MessageSummary>();
  private bodies: Record<string, MessageBody>;
  private searchResults = new Map<string, MessageSummary[]>();
  private seq = 0;
  private log: Array<{ seq: number; type: "upsert" | "delete"; msg?: MessageSummary; id?: string }> = [];
  readonly sentLog: SentLogEntry[] = [];
  readonly drafts = new Map<string, OutgoingMessage>();
  private draftSeq = 0;

  constructor(seed: Seed = {}) {
    this.mailboxes = seed.mailboxes ?? [];
    this.bodies = seed.bodies ?? {};
    (seed.messages ?? []).forEach((m) => this.addMessage(m));
  }

  addMessage(m: MessageSummary): void {
    this.messages.set(m.id, m);
    this.log.push({ seq: ++this.seq, type: "upsert", msg: m });
  }

  removeMessage(id: string): void {
    this.messages.delete(id);
    this.log.push({ seq: ++this.seq, type: "delete", id });
  }

  setSearchResults(q: string, items: MessageSummary[]): void {
    this.searchResults.set(q, items);
  }

  async listMailboxes(): Promise<Mailbox[]> {
    return [...this.mailboxes];
  }

  async listMessages(mailboxId: string, pageToken?: string): Promise<Page<MessageSummary>> {
    const all = [...this.messages.values()]
      .filter((m) => m.mailboxIds.includes(mailboxId))
      .sort((a, b) => b.date - a.date);
    const start = pageToken ? Number(pageToken) : 0;
    const items = all.slice(start, start + this.pageSize);
    const next = start + this.pageSize;
    return { items, nextPageToken: next < all.length ? String(next) : undefined };
  }

  async getMessageBody(id: string): Promise<MessageBody> {
    return this.bodies[id] ?? { id, html: null, text: `body ${id}`, attachments: [], headers: {} };
  }

  async getAttachment(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }

  async search(query: string, pageToken?: string): Promise<Page<MessageSummary>> {
    const all = this.searchResults.get(query) ?? [];
    const start = pageToken ? Number(pageToken) : 0;
    const items = all.slice(start, start + this.pageSize);
    const next = start + this.pageSize;
    return { items, nextPageToken: next < all.length ? String(next) : undefined };
  }

  // A single synthetic "seq" key stands in for the real per-folder delta
  // links a live provider tracks; it's enough to exercise the shared
  // MailProvider contract without modeling Graph's per-folder deltas.
  async initialCursor(): Promise<SyncCursor> {
    return { kind: "ms-graph", deltaLinks: { seq: String(this.seq) } };
  }

  async syncSince(cursor: SyncCursor): Promise<SyncResult> {
    const since = Number(cursor.deltaLinks.seq ?? 0);
    const upserts: MessageSummary[] = [];
    const deletions: string[] = [];
    for (const entry of this.log) {
      if (entry.seq <= since) continue;
      if (entry.type === "upsert" && entry.msg) upserts.push(entry.msg);
      if (entry.type === "delete" && entry.id) deletions.push(entry.id);
    }
    return {
      upserts, deletions, mailboxChanges: [],
      cursor: { kind: "ms-graph", deltaLinks: { seq: String(this.seq) } },
    };
  }

  async sendNewMessage(message: OutgoingMessage): Promise<void> {
    this.sentLog.push({ kind: "new", message });
  }

  async replyToMessage(id: string, mode: "reply" | "replyAll", commentHtml: string): Promise<void> {
    this.sentLog.push({ kind: "reply", targetId: id, mode, commentHtml });
  }

  async forwardMessage(id: string, commentHtml: string, to: Address[]): Promise<void> {
    this.sentLog.push({ kind: "forward", targetId: id, commentHtml, to });
  }

  async createDraft(msg: OutgoingMessage): Promise<string> {
    const id = `draft-${++this.draftSeq}`;
    this.drafts.set(id, msg);
    return id;
  }

  async updateDraft(id: string, msg: OutgoingMessage): Promise<void> {
    if (!this.drafts.has(id)) throw new Error(`no such draft: ${id}`);
    this.drafts.set(id, msg);
  }

  async sendDraft(id: string): Promise<void> {
    if (!this.drafts.has(id)) throw new Error(`no such draft: ${id}`);
    this.drafts.delete(id);
    this.sentLog.push({ kind: "draft", draftId: id });
  }

  async deleteDraft(id: string): Promise<void> {
    if (!this.drafts.has(id)) throw new Error(`no such draft: ${id}`);
    this.drafts.delete(id);
  }

  async deleteMessage(id: string): Promise<void> {
    if (!this.messages.has(id)) throw new Error(`no such message: ${id}`);
    this.removeMessage(id);
  }

  async archiveMessage(id: string): Promise<void> {
    const m = this.messages.get(id);
    if (!m) throw new Error(`no such message: ${id}`);
    const moved: MessageSummary = { ...m, mailboxIds: ["ARCHIVE"] };
    this.addMessage(moved);
  }
}
