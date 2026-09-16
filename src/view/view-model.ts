import type { Address, AttachmentMeta, Mailbox, MailProvider, MessageBody, MessageSummary, OutgoingMessage, ProviderKind } from "../providers/types";
import { AuthError } from "../providers/types";
import type { MailCache } from "../cache/mail-cache";
import type { SyncEngine, SyncStatus } from "../sync/sync-engine";
import type { SettingsStore } from "../settings/settings-store";
import { sanitizeEmailHtml } from "../render/html-sanitizer";
import { defaultNoteFilename, emailToNote } from "../render/email-to-note";

export interface ThreadView {
  threadId: string;
  subject: string;
  lastDate: number;
  messages: MessageSummary[];
  unread: boolean;
}

/** The editable fields of a composer, as of the last load or successful save. */
export interface ComposerSnapshot {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyHtml: string;
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
  /** What was last loaded/saved, for `hasUnsavedComposerContent`. Only the
   *  draft-backed modes (`new`, `editDraft`) have one; `null` elsewhere. */
  savedSnapshot: ComposerSnapshot | null;
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
  saveNote: (defaultPath: string, content: string) => void;
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

/** Quill serializes an empty editor as "<p><br></p>"; treat it as no body. */
function normalizeBody(html: string): string {
  const trimmed = html.trim();
  return trimmed === "<p><br></p>" ? "" : trimmed;
}

function snapshotOf(c: ComposerSnapshot): ComposerSnapshot {
  return { to: c.to, cc: c.cc, bcc: c.bcc, subject: c.subject, bodyHtml: c.bodyHtml };
}

/** Compares by value, not identity: every field edit replaces the array. */
function sameAddresses(a: Address[], b: Address[]): boolean {
  const key = (list: Address[]) => list.map((x) => `${x.name ?? ""}<${x.email}>`).join(",");
  return key(a) === key(b);
}

function sameSnapshot(a: ComposerSnapshot, b: ComposerSnapshot): boolean {
  return sameAddresses(a.to, b.to) && sameAddresses(a.cc, b.cc) && sameAddresses(a.bcc, b.bcc)
    && a.subject === b.subject && normalizeBody(a.bodyHtml) === normalizeBody(b.bodyHtml);
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
        if (e.accountId !== this.state.activeAccountId) return;
        // Independent of the search guard below — the folder list is UI
        // chrome, not search results, so it stays live even mid-search.
        void this.refreshMailboxes(e.accountId);
        if (!this.state.search.active) void this.reloadList();
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
      // Navigation always drops the composer (see `closeThread`).
      composer: null,
    });
    if (inbox) await this.selectMailbox(inbox.id);
  }

  /** Re-reads the cached folder list for `accountId` and refreshes
   *  `state.mailboxes` — called on every sync change so a folder created or
   *  deleted elsewhere (another mail client) shows up without switching
   *  accounts. Falls back to Inbox/first if the active mailbox was one of
   *  the ones removed. */
  private async refreshMailboxes(accountId: string): Promise<void> {
    const mailboxes = await this.deps.cache.getMailboxes(accountId);
    if (accountId !== this.state.activeAccountId) return; // stale by the time this resolved
    const sorted = sortMailboxes(mailboxes);
    this.set({ mailboxes: sorted });
    if (sorted.length === 0 || sorted.some((m) => m.id === this.state.activeMailboxId)) return;
    const fallback = sorted.find((m) => m.kind === "inbox") ?? sorted[0];
    if (this.state.search.active) {
      // selectMailbox clears the search — appropriate for a user-initiated
      // switch, but not for one forced by the active mailbox disappearing
      // out from under an in-progress search. Just retarget activeMailboxId
      // and drop paging state (it's tied to the old mailbox's list), and
      // leave the search results exactly as reloadList already does.
      this.providerListToken = undefined;
      this.providerListExhausted = false;
      this.set({ activeMailboxId: fallback.id });
      return;
    }
    await this.selectMailbox(fallback.id);
  }

  async selectMailbox(id: string): Promise<void> {
    this.set({ activeMailboxId: id, search: { query: "", active: false }, composer: null });
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
    this.set({
      openThreadId: threadId, openMessages: summaries.map((s) => ({ summary: s })),
      // Navigation always drops the composer (see `closeThread`).
      composer: null,
    });
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

  /**
   * Navigating away always drops the composer, which the view otherwise can't
   * render: a `new`/`editDraft` composer takes over the whole reading pane
   * (hiding the thread that was just opened), and a reply/forward composer
   * lives inside the `MessageBlock` for its `targetMessageId`, which a
   * different thread, mailbox or account no longer shows. Clearing is safe
   * because it has no provider side effects (no `deleteDraft`) and because
   * App.svelte routes these navigations through the same save/discard prompt
   * as the compose actions, so unsaved content is resolved before we get here.
   */
  closeThread(): void {
    this.set({ openThreadId: null, openMessages: [], composer: null });
  }

  private openComposer(state: Omit<ComposerState, "to" | "cc" | "bcc" | "subject" | "bodyHtml" | "sending" | "error" | "savedSnapshot">): void {
    const composer: ComposerState = {
      // Explicit undefined defaults (rather than omitting the keys) so
      // consumers can rely on `targetMessageId`/`draftId` always being
      // present on the composer object, even when not applicable to `mode`.
      targetMessageId: undefined, draftId: undefined,
      ...state,
      to: [], cc: [], bcc: [], subject: "", bodyHtml: "", sending: false, error: null,
      savedSnapshot: null,
    };
    // A "new" composer can be saved as a draft, so it starts from a snapshot
    // of its own (empty) fields; reply/replyAll/forward have no save path and
    // stay on the body-content check in `hasUnsavedComposerContent`.
    this.set({ composer: composer.mode === "new" ? { ...composer, savedSnapshot: snapshotOf(composer) } : composer });
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
    if (c.mode === "new" || c.mode === "editDraft") {
      // Draft-backed modes compare against the last loaded/saved snapshot, so
      // an untouched draft doesn't prompt (whose "Discard" would delete it)
      // and a recipients-only edit with an empty body still does.
      return c.savedSnapshot === null || !sameSnapshot(c, c.savedSnapshot);
    }
    // reply/replyAll/forward can't be saved at all; any body content is at risk.
    return normalizeBody(c.bodyHtml) !== "";
  }

  closeComposer(): void {
    this.set({ composer: null });
  }

  private errorMessage(err: unknown): string {
    if (err instanceof AuthError) {
      return "Reauthentication required — go to Settings → Email and click Re-authenticate.";
    }
    return err instanceof Error ? err.message : String(err);
  }

  private outgoingMessage(c: ComposerState): OutgoingMessage {
    return {
      to: c.to, cc: c.cc, bcc: c.bcc, subject: c.subject,
      bodyHtml: sanitizeEmailHtml(c.bodyHtml, { allowRemote: true }).html,
    };
  }

  async send(): Promise<void> {
    const c = this.state.composer;
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!c || !provider) return;
    this.set({ composer: { ...c, sending: true, error: null } });
    try {
      const html = sanitizeEmailHtml(c.bodyHtml, { allowRemote: true }).html;
      if (c.mode === "new") {
        await provider.sendNewMessage(this.outgoingMessage(c));
        if (c.draftId) {
          try {
            await provider.deleteDraft(c.draftId);
          } catch {
            /* best effort — the send already succeeded */
          }
        }
      } else if (c.mode === "reply" || c.mode === "replyAll") {
        await provider.replyToMessage(c.targetMessageId!, c.mode, html);
      } else if (c.mode === "forward") {
        await provider.forwardMessage(c.targetMessageId!, html, c.to);
      } else {
        // editDraft: push the latest edits, then send the draft as-is.
        await provider.updateDraft(c.draftId!, this.outgoingMessage(c));
        await provider.sendDraft(c.draftId!);
      }
      this.set({ composer: null, notice: "Sent." });
    } catch (err) {
      this.set({ composer: { ...this.state.composer!, sending: false, error: this.errorMessage(err) } });
    }
  }

  async saveDraft(): Promise<void> {
    const c = this.state.composer;
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!c || !provider || (c.mode !== "new" && c.mode !== "editDraft")) return;
    this.set({ composer: { ...c, sending: true, error: null } });
    try {
      const msg = this.outgoingMessage(c);
      let draftId = c.draftId;
      if (draftId) await provider.updateDraft(draftId, msg);
      else draftId = await provider.createDraft(msg);
      // Snapshot what was actually persisted (`c`), not the live composer:
      // anything typed while the save was in flight is still unsaved.
      this.set({ composer: { ...this.state.composer!, draftId, sending: false, savedSnapshot: snapshotOf(c) } });
    } catch (err) {
      this.set({ composer: { ...this.state.composer!, sending: false, error: this.errorMessage(err) } });
    }
  }

  async discardDraft(): Promise<void> {
    const c = this.state.composer;
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (c?.draftId && provider) {
      try {
        await provider.deleteDraft(c.draftId);
      } catch {
        /* best effort — the composer closes either way */
      }
    }
    this.set({ composer: null });
  }

  private async actOnMessage(messageId: string, action: (provider: MailProvider) => Promise<void>): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) return;
    try {
      await action(provider);
      await this.deps.cache.deleteMessages(acct, [messageId]);
      if (this.state.openMessages.some((m) => m.summary.id === messageId)) this.closeThread();
      await this.reloadListUnlessSearching();
    } catch (err) {
      this.set({ notice: this.errorMessage(err) });
    }
  }

  /**
   * `reloadList` repaints from the ACTIVE MAILBOX, which is not what the list
   * is showing during a search (`runSearch` swaps in mailbox-wide results and
   * leaves `activeMailboxId` alone). Calling it there would drop the user's
   * results for the current folder's listing under a still-populated search
   * box, so the search view is simply left as it is — the cache and Graph are
   * updated either way, only the visible rows go stale until the user
   * re-searches or clears. Mirrors the `search.active` checks already guarding
   * the sync-change handler and `loadMore`.
   */
  private async reloadListUnlessSearching(): Promise<void> {
    if (this.state.search.active) return;
    await this.reloadList();
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.actOnMessage(messageId, (provider) => provider.deleteMessage(messageId));
  }

  async archiveMessage(messageId: string): Promise<void> {
    await this.actOnMessage(messageId, (provider) => provider.archiveMessage(messageId));
  }

  private async actOnThread(
    threadId: string,
    action: (provider: MailProvider, id: string) => Promise<void>,
    pastTense: "Deleted" | "Archived",
  ): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) return;
    try {
      const messages = await this.deps.cache.getThreadMessages(acct, threadId);
      // Nothing cached under this threadId — a search hit whose conversation
      // was never independently cached, say. There is nothing to act on, and
      // the partial-failure notice below can't fire for an empty input, so say
      // so explicitly rather than appearing to do nothing at all.
      if (messages.length === 0) {
        this.set({ notice: "Couldn't find any messages in that thread." });
        return;
      }
      const results = await Promise.allSettled(messages.map((m) => action(provider, m.id)));
      const succeededIds = messages.filter((_, i) => results[i].status === "fulfilled").map((m) => m.id);
      const failedCount = results.length - succeededIds.length;
      if (succeededIds.length) await this.deps.cache.deleteMessages(acct, succeededIds);
      if (this.state.openThreadId === threadId) this.closeThread();
      await this.reloadListUnlessSearching();
      if (failedCount > 0) {
        this.set({
          notice: succeededIds.length === 0
            ? `Couldn't ${pastTense.toLowerCase()} this thread.`
            : `${pastTense} ${succeededIds.length} of ${messages.length} messages — ${failedCount} failed.`,
        });
      }
    } catch (err) {
      // The cache reads/writes and the reload can all throw (an IndexedDB
      // failure, say); without this the rejection escapes unhandled and the
      // user is told nothing. Mirrors `actOnMessage`.
      this.set({ notice: this.errorMessage(err) });
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.actOnThread(threadId, (provider, id) => provider.deleteMessage(id), "Deleted");
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.actOnThread(threadId, (provider, id) => provider.archiveMessage(id), "Archived");
  }

  async openDraftForEdit(messageId: string): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) return;
    // The Edit action only exists inside an expanded MessageBlock, so the
    // draft's summary is always among the open messages. It must NOT be looked
    // up through `cache.getThreadMessages(acct, messageId)`: that queries by
    // threadId, and Graph's conversationId is a distinct opaque id that never
    // equals the message's own id — a miss there prefills blank recipients and
    // the next save would overwrite the real draft with them.
    const summary = this.state.openMessages.find((m) => m.summary.id === messageId)?.summary;
    if (!summary) {
      this.set({ notice: "Couldn't open that draft." });
      return;
    }
    let body: MessageBody;
    try {
      body = await provider.getMessageBody(messageId);
    } catch {
      // Leave the composer untouched: a partial one bound to this draftId
      // would overwrite the draft with whatever it managed to prefill.
      this.set({ notice: "Couldn't load a message body." });
      return;
    }
    const composer: ComposerState = {
      mode: "editDraft",
      targetMessageId: undefined,
      draftId: messageId,
      to: summary.to,
      cc: summary.cc,
      bcc: summary.bcc ?? [],
      subject: summary.subject,
      bodyHtml: body.html ?? "",
      sending: false,
      error: null,
      savedSnapshot: null,
    };
    // The loaded draft is itself the "last saved" state to compare against.
    this.set({ composer: { ...composer, savedSnapshot: snapshotOf(composer) } });
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

  /** Converts the given (already-open) message to a Markdown note — sender,
   *  recipients, subject, received date and message id as frontmatter — and
   *  hands it to the host to prompt for a save location. */
  async saveMessageToVault(messageId: string): Promise<void> {
    const found = this.state.openMessages.find((m) => m.summary.id === messageId);
    if (!found) return;
    let body = found.body;
    if (!body) {
      const acct = this.state.activeAccountId;
      body = acct ? await this.deps.cache.getBody(acct, messageId) : undefined;
      if (!body) {
        this.set({ notice: "Message body still loading — try again in a moment." });
        return;
      }
    }
    this.deps.saveNote(defaultNoteFilename(found.summary), emailToNote(found.summary, body));
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
