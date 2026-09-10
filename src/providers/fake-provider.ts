import type {
  MailProvider, Mailbox, MessageBody, MessageSummary, Page, SyncCursor, SyncResult,
} from "./types";

interface Seed {
  mailboxes?: Mailbox[];
  messages?: MessageSummary[];
  bodies?: Record<string, MessageBody>;
}

export class FakeProvider implements MailProvider {
  readonly kind = "gmail" as const;
  pageSize = 2;

  private mailboxes: Mailbox[];
  private messages = new Map<string, MessageSummary>();
  private bodies: Record<string, MessageBody>;
  private searchResults = new Map<string, MessageSummary[]>();
  private seq = 0;
  private log: Array<{ seq: number; type: "upsert" | "delete"; msg?: MessageSummary; id?: string }> = [];

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

  async initialCursor(): Promise<SyncCursor> {
    return { kind: "gmail", historyId: String(this.seq) };
  }

  async syncSince(cursor: SyncCursor): Promise<SyncResult> {
    const since = cursor.kind === "gmail" ? Number(cursor.historyId) : 0;
    const upserts: MessageSummary[] = [];
    const deletions: string[] = [];
    for (const entry of this.log) {
      if (entry.seq <= since) continue;
      if (entry.type === "upsert" && entry.msg) upserts.push(entry.msg);
      if (entry.type === "delete" && entry.id) deletions.push(entry.id);
    }
    return {
      upserts, deletions, mailboxChanges: [],
      cursor: { kind: "gmail", historyId: String(this.seq) },
    };
  }
}
