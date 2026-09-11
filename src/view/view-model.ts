import type { Address, AttachmentMeta, Mailbox, MailProvider, MessageBody, MessageSummary, OutgoingMessage, ProviderKind } from "../providers/types";
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

export interface ComposerState {
  mode: "reply" | "replyAll" | "forward" | "new" | "editDraft";
  targetMessageId?: string;
  draftId?: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyHtml: string;
  sending: boolean;
  error: string | null;
}

export interface ViewState {
  accounts: Array<{ id: string; email: string; provider: ProviderKind; status: SyncStatus }>;
  activeAccountId: string | null;
  mailboxes: Mailbox[];
  activeMailboxId: string | null;
  threads: ThreadView[];
  hasMore: boolean;
  loadingList: boolean;
  /** Mirrors `prefs.autoLoadImages`; drives the renderer's `allowRemote`. */
  autoLoadImages: boolean;
  search: { query: string; active: boolean };
  openThreadId: string | null;
  openMessages: Array<{ summary: MessageSummary; body?: MessageBody }>;
  notice: string | null;
  composer: ComposerState | null;
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
    threads: [], hasMore: false, loadingList: false, autoLoadImages: false,
    search: { query: "", active: false },
    openThreadId: null, openMessages: [], notice: null,
    composer: null,
  };
  private listeners = new Set<(s: ViewState) => void>();
  private unsubSync: Array<() => void> = [];
  private providerListToken: string | undefined;
  private providerListExhausted = false;
  /** Monotonic guard so a slow cache read can't paint over a newer one. */
  private reloadSeq = 0;
  private readonly _renderDeps: {
    getInlineAttachment: (cid: string) => Promise<Blob | undefined>;
    openExternal: (url: string) => void;
  };

  constructor(private deps: ViewModelDeps) {
    this._renderDeps = {
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

  /**
   * Pull preference-derived state out of the settings store. Settings have no
   * change emitter, so this is re-read at the points where the user can have
   * been in the settings tab since we last looked.
   */
  private syncPrefs(): void {
    const { autoLoadImages } = this.deps.settings.get().prefs;
    if (autoLoadImages !== this.state.autoLoadImages) this.set({ autoLoadImages });
  }

  async init(): Promise<void> {
    const cfg = this.deps.settings.get();
    this.set({ autoLoadImages: cfg.prefs.autoLoadImages });
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
    this.syncPrefs();
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
    // Switching mailbox A -> B fires two overlapping reads; without this guard
    // a slow read for A that lands after B's would paint A's rows under B's
    // header.
    const seq = ++this.reloadSeq;
    this.set({ loadingList: true });
    const limit = PAGE * 4;
    const rows = await this.deps.cache.listMailboxMessages(acct, mb, { limit });
    if (seq !== this.reloadSeq) return;
    this.set({
      threads: groupThreads(rows),
      // Offer "load more" when the cache filled a page, when a provider cursor
      // is still open, or when the cache is empty for this mailbox. The last
      // case covers folders `SyncEngine.backfill` never populates (Spam, Trash,
      // custom labels) — without it, selecting one shows a permanent "No
      // messages" with no way to fetch. A short-but-non-empty page for an
      // already-exhausted mailbox stays `false` (via `providerListExhausted`),
      // so opening the view still doesn't fire an unrequested round-trip.
      hasMore: !this.providerListExhausted && (rows.length >= limit || this.providerListToken !== undefined || rows.length === 0),
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

  private openComposer(state: Omit<ComposerState, "to" | "cc" | "bcc" | "subject" | "bodyHtml" | "sending" | "error">): void {
    this.set({
      composer: {
        // Explicit undefined defaults (rather than omitting the keys) so
        // consumers can rely on `targetMessageId`/`draftId` always being
        // present on the composer object, even when not applicable to `mode`.
        targetMessageId: undefined, draftId: undefined,
        ...state,
        to: [], cc: [], bcc: [], subject: "", bodyHtml: "", sending: false, error: null,
      },
    });
  }

  openReply(messageId: string, mode: "reply" | "replyAll"): void {
    this.openComposer({ mode, targetMessageId: messageId });
  }

  openForward(messageId: string): void {
    this.openComposer({ mode: "forward", targetMessageId: messageId });
  }

  openNewMessage(): void {
    this.openComposer({ mode: "new" });
  }

  updateComposerFields(patch: Partial<Pick<ComposerState, "to" | "cc" | "bcc" | "subject">>): void {
    if (!this.state.composer) return;
    this.set({ composer: { ...this.state.composer, ...patch } });
  }

  updateComposerBody(html: string): void {
    if (!this.state.composer) return;
    this.set({ composer: { ...this.state.composer, bodyHtml: html } });
  }

  hasUnsavedComposerContent(): boolean {
    const c = this.state.composer;
    if (!c) return false;
    // Quill's empty-editor markup is "<p><br></p>"; anything else is content.
    return c.bodyHtml.trim() !== "" && c.bodyHtml.trim() !== "<p><br></p>";
  }

  closeComposer(): void {
    this.set({ composer: null });
  }

  renderDeps(): { getInlineAttachment: (cid: string) => Promise<Blob | undefined>; openExternal: (url: string) => void } {
    return this._renderDeps;
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
    this.syncPrefs();
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
