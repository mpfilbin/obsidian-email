import type { AttachmentMeta, Mailbox, MailProvider, MessageBody, MessageSummary, ProviderKind } from "../providers/types";
import type { MailCache } from "../cache/mail-cache";
import type { SyncEngine, SyncStatus } from "../sync/sync-engine";
import type { SettingsStore } from "../settings/settings-store";

export interface ThreadView {
  threadId: string;
  subject: string;
  lastDate: number;
  messages: MessageSummary[];
  unread: boolean;
}

export interface ViewState {
  accounts: Array<{ id: string; email: string; provider: ProviderKind; status: SyncStatus }>;
  activeAccountId: string | null;
  mailboxes: Mailbox[];
  activeMailboxId: string | null;
  threads: ThreadView[];
  hasMore: boolean;
  loadingList: boolean;
  search: { query: string; active: boolean };
  openThreadId: string | null;
  openMessages: Array<{ summary: MessageSummary; body?: MessageBody }>;
  notice: string | null;
}

export interface ViewModelDeps {
  cache: MailCache;
  sync: SyncEngine;
  settings: SettingsStore;
  getProvider: (id: string) => MailProvider | undefined;
  isOnline: () => boolean;
  openExternal: (url: string) => void;
  saveBlob: (blob: Blob, filename: string) => Promise<void>;
}

const PAGE = 50;

function groupThreads(messages: MessageSummary[]): ThreadView[] {
  const byThread = new Map<string, MessageSummary[]>();
  for (const m of messages) {
    const arr = byThread.get(m.threadId) ?? [];
    arr.push(m);
    byThread.set(m.threadId, arr);
  }
  const threads: ThreadView[] = [];
  for (const [threadId, msgs] of byThread) {
    msgs.sort((a, b) => a.date - b.date);
    threads.push({
      threadId,
      subject: msgs[msgs.length - 1].subject,
      lastDate: Math.max(...msgs.map((m) => m.date)),
      messages: msgs,
      unread: msgs.some((m) => m.unread),
    });
  }
  threads.sort((a, b) => b.lastDate - a.lastDate);
  return threads;
}

export class ViewModel {
  private state: ViewState = {
    accounts: [], activeAccountId: null, mailboxes: [], activeMailboxId: null,
    threads: [], hasMore: false, loadingList: false,
    search: { query: "", active: false },
    openThreadId: null, openMessages: [], notice: null,
  };
  private listeners = new Set<(s: ViewState) => void>();
  private unsubSync: Array<() => void> = [];
  private providerListToken: string | undefined;
  private providerListExhausted = false;

  constructor(private deps: ViewModelDeps) {
    this.unsubSync.push(
      deps.sync.changes.on((e) => {
        if (e.accountId === this.state.activeAccountId && !this.state.search.active) {
          void this.reloadList();
        }
      }),
      deps.sync.states.on(() => this.refreshAccountStatuses()),
    );
  }

  getState(): ViewState { return this.state; }

  subscribe(fn: (s: ViewState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<ViewState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of [...this.listeners]) fn(this.state);
  }

  private refreshAccountStatuses(): void {
    this.set({
      accounts: this.state.accounts.map((a) => ({ ...a, status: this.deps.sync.getState(a.id).status })),
    });
  }

  async init(): Promise<void> {
    const cfg = this.deps.settings.get();
    const accounts = cfg.accounts.map((a) => ({
      id: a.id, email: a.email, provider: a.provider, status: this.deps.sync.getState(a.id).status,
    }));
    const active = cfg.prefs.defaultAccountId && accounts.some((a) => a.id === cfg.prefs.defaultAccountId)
      ? cfg.prefs.defaultAccountId
      : accounts[0]?.id ?? null;
    this.set({ accounts, activeAccountId: active });
    if (active) await this.selectAccount(active);
  }

  async selectAccount(id: string): Promise<void> {
    const mailboxes = await this.deps.cache.getMailboxes(id);
    const inbox = mailboxes.find((m) => m.kind === "inbox") ?? mailboxes[0];
    this.set({
      activeAccountId: id,
      mailboxes: sortMailboxes(mailboxes),
      activeMailboxId: inbox?.id ?? null,
      search: { query: "", active: false },
      openThreadId: null, openMessages: [],
    });
    if (inbox) await this.selectMailbox(inbox.id);
  }

  async selectMailbox(id: string): Promise<void> {
    this.set({ activeMailboxId: id, search: { query: "", active: false } });
    this.providerListToken = undefined;
    this.providerListExhausted = false;
    await this.reloadList();
  }

  private async reloadList(): Promise<void> {
    const acct = this.state.activeAccountId;
    const mb = this.state.activeMailboxId;
    if (!acct || !mb) return;
    this.set({ loadingList: true });
    const rows = await this.deps.cache.listMailboxMessages(acct, mb, { limit: PAGE * 4 });
    this.set({
      threads: groupThreads(rows),
      hasMore: !this.providerListExhausted,
      loadingList: false,
    });
  }

  async loadMore(): Promise<void> {
    const acct = this.state.activeAccountId;
    const mb = this.state.activeMailboxId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !mb || !provider || this.providerListExhausted) return;
    if (this.state.search.active) return;
    this.set({ loadingList: true });
    try {
      const page = await provider.listMessages(mb, this.providerListToken);
      if (page.items.length) await this.deps.cache.upsertMessages(acct, page.items);
      this.providerListToken = page.nextPageToken;
      this.providerListExhausted = !page.nextPageToken;
    } catch {
      this.set({ notice: "Couldn't load more messages." });
    }
    await this.reloadList();
  }

  async openThread(threadId: string): Promise<void> {
    const acct = this.state.activeAccountId;
    if (!acct) return;
    const summaries = await this.deps.cache.getThreadMessages(acct, threadId);
    this.set({ openThreadId: threadId, openMessages: summaries.map((s) => ({ summary: s })) });
    const provider = this.deps.getProvider(acct);
    for (const s of summaries) {
      let body = await this.deps.cache.getBody(acct, s.id);
      if (!body && provider) {
        try {
          body = await provider.getMessageBody(s.id);
          await this.deps.cache.putBody(acct, body);
        } catch {
          this.set({ notice: "Couldn't load a message body." });
        }
      }
      if (this.state.openThreadId !== threadId) return;
      this.set({
        openMessages: this.state.openMessages.map((m) =>
          m.summary.id === s.id ? { ...m, body: body ?? m.body } : m,
        ),
      });
    }
  }

  closeThread(): void {
    this.set({ openThreadId: null, openMessages: [] });
  }

  renderDeps(): { getInlineAttachment: (cid: string) => Promise<Blob | undefined>; openExternal: (url: string) => void } {
    return {
      openExternal: (url: string) => this.deps.openExternal(url),
      getInlineAttachment: async (cid: string) => {
        const acct = this.state.activeAccountId;
        const provider = acct ? this.deps.getProvider(acct) : undefined;
        if (!acct || !provider) return undefined;
        for (const m of this.state.openMessages) {
          const att = m.body?.attachments.find((a) => a.inline && a.contentId === cid);
          if (att) {
            const buf = await provider.getAttachment(m.summary.id, att.id);
            return new Blob([buf], { type: att.mimeType });
          }
        }
        return undefined;
      },
    };
  }

  async downloadAttachment(messageId: string, att: AttachmentMeta): Promise<Blob> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) throw new Error("No active account");
    const buf = await provider.getAttachment(messageId, att.id);
    return new Blob([buf], { type: att.mimeType });
  }

  async downloadAttachmentToDisk(messageId: string, att: AttachmentMeta): Promise<void> {
    const blob = await this.downloadAttachment(messageId, att);
    await this.deps.saveBlob(blob, att.filename);
  }

  async refresh(): Promise<void> {
    if (this.state.activeAccountId) await this.deps.sync.syncAccount(this.state.activeAccountId);
  }

  async runSearch(query: string): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) return;
    if (!this.deps.isOnline()) {
      this.set({ notice: "Search is unavailable while offline." });
      return;
    }
    this.set({ loadingList: true, notice: null });
    try {
      const page = await provider.search(query);
      this.set({
        search: { query, active: true },
        threads: groupThreads(page.items),
        hasMore: false,
        loadingList: false,
      });
    } catch {
      this.set({ loadingList: false, notice: "Search failed." });
    }
  }

  async clearSearch(): Promise<void> {
    this.set({ search: { query: "", active: false }, notice: null });
    await this.reloadList();
  }

  dispose(): void {
    for (const off of this.unsubSync) off();
    this.unsubSync = [];
    this.listeners.clear();
  }
}

const MAILBOX_ORDER: Record<string, number> = {
  inbox: 0, sent: 1, drafts: 2, archive: 3, spam: 4, trash: 5, custom: 6,
};

function sortMailboxes(boxes: Mailbox[]): Mailbox[] {
  return [...boxes].sort((a, b) => {
    const d = (MAILBOX_ORDER[a.kind] ?? 9) - (MAILBOX_ORDER[b.kind] ?? 9);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
}
