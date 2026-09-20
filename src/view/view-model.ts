import type { Address, AttachmentMeta, Contact, ContactDraft, Mailbox, MailProvider, MessageBody, MessageSummary, OutgoingAttachment, OutgoingMessage, ProviderKind } from "../providers/types";
import { AuthError, ContactsConsentRequired, supportsContacts } from "../providers/types";
import type { MailCache } from "../cache/mail-cache";
import type { SyncEngine, SyncStatus } from "../sync/sync-engine";
import type { ContactStore } from "../cache/contact-cache";
import type { ContactSync, ContactsStatus } from "../sync/contact-sync";
import { draftFromContact, emptyDraft, finalizeDraft, patchBetween, sameDraft, sortContacts, validateDraft } from "./contact-draft";
import { rankSuggestions, type RecipientSuggestion } from "./recipient-suggest";
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
  attachments: OutgoingAttachment[];
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
  attachments: OutgoingAttachment[];
  sending: boolean;
  error: string | null;
  /** What was last loaded/saved, for `hasUnsavedComposerContent`. Only the
   *  draft-backed modes (`new`, `editDraft`) have one; `null` elsewhere. */
  savedSnapshot: ComposerSnapshot | null;
}

/** An open New/Edit contact form. `saved` is the baseline `hasUnsavedContactEdit` compares against. */
export interface ContactEditState {
  mode: "new" | "edit";
  contactId?: string;
  draft: ContactDraft;
  saved: ContactDraft;
  error: string | null;
  saving: boolean;
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
  /** Mirror `prefs.ribbonEnabled` / `prefs.ribbonCollapsedByDefault`. */
  ribbonEnabled: boolean;
  ribbonCollapsedByDefault: boolean;
  composer: ComposerState | null;
  /** Which set of panes the view shows. */
  mode: "mail" | "contacts";
  /** The active account's cached contacts, sorted by display name. */
  contacts: Contact[];
  contactsStatus: ContactsStatus;
  contactSearch: string;
  selectedContactId: string | null;
  contactEdit: ContactEditState | null;
}

export interface ViewModelDeps {
  cache: MailCache;
  sync: SyncEngine;
  contactStore: ContactStore;
  contactSync: ContactSync;
  /** Re-runs OAuth so an account gains the Contacts scope (Task 8 consumer). */
  grantContactsAccess: (accountId: string) => Promise<void>;
  settings: SettingsStore;
  getProvider: (id: string) => MailProvider | undefined;
  isOnline: () => boolean;
  openExternal: (url: string) => void;
  saveBlob: (blob: Blob, filename: string) => Promise<void>;
  saveNote: (defaultPath: string, content: string) => void;
  /** Prompts for a new folder name; calls `onSubmit` with it if confirmed. */
  promptFolderName: (onSubmit: (name: string) => void) => void;
  /** Prompts for a folder's new name, pre-filled with `currentName`. */
  promptFolderRename: (currentName: string, onSubmit: (name: string) => void) => void;
  /** Lets the user pick a vault note and resolves with it as an attachment,
   *  or `undefined` if the picker is dismissed or the note couldn't be read. */
  pickNoteAttachment: () => Promise<OutgoingAttachment | undefined>;
  /** Shows a transient, auto-dismissing toast (Obsidian's own `Notice`) —
   *  used for one-off confirmations and errors instead of persistent state. */
  showNotice: (message: string) => void;
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
  return { to: c.to, cc: c.cc, bcc: c.bcc, subject: c.subject, bodyHtml: c.bodyHtml, attachments: c.attachments };
}

/** Compares by value, not identity: every field edit replaces the array. */
function sameAddresses(a: Address[], b: Address[]): boolean {
  const key = (list: Address[]) => list.map((x) => `${x.name ?? ""}<${x.email}>`).join(",");
  return key(a) === key(b);
}

/** Attachments are only ever staged wholesale (never edited in place), so
 *  comparing filenames positionally is enough to detect a real add/remove —
 *  and avoids miscomparing a comma-joined string when a filename itself
 *  contains a comma. */
function sameAttachments(a: OutgoingAttachment[], b: OutgoingAttachment[]): boolean {
  return a.length === b.length && a.every((x, i) => x.filename === b[i].filename);
}

function sameSnapshot(a: ComposerSnapshot, b: ComposerSnapshot): boolean {
  return sameAddresses(a.to, b.to) && sameAddresses(a.cc, b.cc) && sameAddresses(a.bcc, b.bcc)
    && a.subject === b.subject && normalizeBody(a.bodyHtml) === normalizeBody(b.bodyHtml)
    && sameAttachments(a.attachments, b.attachments);
}

export class ViewModel {
  private state: ViewState = {
    accounts: [], activeAccountId: null, mailboxes: [], activeMailboxId: null,
    threads: [], hasMore: false, loadingList: false, autoLoadImages: false,
    search: { query: "", active: false },
    openThreadId: null, openMessages: [],
    ribbonEnabled: true, ribbonCollapsedByDefault: false,
    composer: null, mode: "mail", contacts: [], contactsStatus: "idle", contactSearch: "",
    selectedContactId: null, contactEdit: null,
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
      deps.contactSync.changes.on((e) => {
        if (e.accountId === this.state.activeAccountId) void this.loadContacts(e.accountId);
      }),
      deps.contactSync.states.on((s) => {
        if (s.accountId === this.state.activeAccountId) this.set({ contactsStatus: s.status });
      }),
    );
    // The view mounts before `init()`, and with no accounts `init()` never reaches
    // `selectAccount` — so the ribbon prefs must already be in state at construction.
    this.syncPrefs();
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
    const { autoLoadImages, ribbonEnabled, ribbonCollapsedByDefault } = this.deps.settings.get().prefs;
    if (
      autoLoadImages !== this.state.autoLoadImages ||
      ribbonEnabled !== this.state.ribbonEnabled ||
      ribbonCollapsedByDefault !== this.state.ribbonCollapsedByDefault
    ) {
      this.set({ autoLoadImages, ribbonEnabled, ribbonCollapsedByDefault });
    }
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
      selectedContactId: null, contactEdit: null, contactSearch: "",
    });
    await this.loadContacts(id);
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

  /** Prompts for a name via the host, then creates the folder. */
  requestCreateMailbox(): void {
    this.deps.promptFolderName((name) => { void this.createMailbox(name); });
  }

  /** Prompts (via the host) for a new name for `id`, pre-filled with its
   *  current one, then renames it. */
  requestRenameMailbox(id: string): void {
    const box = this.state.mailboxes.find((m) => m.id === id);
    if (!box) return;
    this.deps.promptFolderRename(box.name, (name) => { void this.renameMailbox(id, name); });
  }

  private async createMailbox(name: string): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) return;
    try {
      const box = await provider.createMailbox(name);
      await this.deps.cache.putMailboxes(acct, [box]);
      this.set({ mailboxes: sortMailboxes([...this.state.mailboxes, box]) });
      // A newly created folder is empty, but jumping straight into it is a
      // nicer confirmation that it worked than leaving the user where they
      // were and making them find it themselves in the (now longer) list.
      await this.selectMailbox(box.id);
    } catch (err) {
      this.deps.showNotice(this.errorMessage(err));
    }
  }

  /** Renames a folder — triggered from the mailbox list's context menu,
   *  which prompts for the new name itself (main.ts) before calling this. */
  async renameMailbox(id: string, newName: string): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) return;
    try {
      const box = await provider.renameMailbox(id, newName);
      await this.deps.cache.putMailboxes(acct, [box]);
      this.set({ mailboxes: sortMailboxes(this.state.mailboxes.map((m) => (m.id === id ? box : m))) });
    } catch (err) {
      this.deps.showNotice(this.errorMessage(err));
    }
  }

  /** Permanently deletes a folder and its messages — the context menu's
   *  "Delete" already confirmed this with the user (App.svelte) before
   *  calling here, since Graph has no undo for a deleted folder. Reuses
   *  refreshMailboxes' existing fallback so a deleted active mailbox behaves
   *  exactly like one removed by another mail client mid-sync. */
  async deleteMailbox(id: string): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !provider) return;
    try {
      await provider.deleteMailbox(id);
      await this.deps.cache.deleteMailboxes(acct, [id]);
      await this.deps.cache.deleteMessagesByMailbox(acct, [id]);
      await this.refreshMailboxes(acct);
    } catch (err) {
      this.deps.showNotice(this.errorMessage(err));
    }
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
      this.deps.showNotice("Couldn't load more messages.");
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
          this.deps.showNotice("Couldn't load a message body.");
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

  private openComposer(
    state: Omit<ComposerState, "to" | "cc" | "bcc" | "subject" | "bodyHtml" | "attachments" | "sending" | "error" | "savedSnapshot">,
    initial?: { subject?: string; bodyHtml?: string; attachments?: OutgoingAttachment[]; to?: Address[] },
  ): void {
    const composer: ComposerState = {
      // Explicit undefined defaults (rather than omitting the keys) so
      // consumers can rely on `targetMessageId`/`draftId` always being
      // present on the composer object, even when not applicable to `mode`.
      targetMessageId: undefined, draftId: undefined,
      ...state,
      to: initial?.to ?? [], cc: [], bcc: [],
      subject: initial?.subject ?? "",
      bodyHtml: initial?.bodyHtml ?? "",
      attachments: initial?.attachments ?? [],
      sending: false, error: null,
      savedSnapshot: null,
    };
    // A "new" composer can be saved as a draft, so it starts from a snapshot
    // of its own fields — but the BLANK ones for subject/body/attachments even
    // when pre-filled (from a note): closing without saving should warn about
    // losing that content exactly as it would for anything typed by hand. The
    // one exception is `to`: a message addressed from a contact ("Email") has
    // recipients the user never typed, so they aren't unsaved content.
    const blank: ComposerSnapshot = { to: initial?.to ?? [], cc: [], bcc: [], subject: "", bodyHtml: "", attachments: [] };
    this.set({ mode: "mail", composer: composer.mode === "new" ? { ...composer, savedSnapshot: blank } : composer });
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

  /** Opens a new composer pre-filled with a note's content, rendered to
   *  HTML, as the body — triggered from the "Create email from note"
   *  command (main.ts), which does the Markdown rendering itself. */
  openComposeFromNote(subject: string, bodyHtml: string): void {
    this.openComposer({ mode: "new" }, { subject, bodyHtml });
  }

  /** Opens a blank new composer with a note already staged as an
   *  attachment — triggered from the "Create email with note attached"
   *  command. */
  openComposeWithAttachment(attachment: OutgoingAttachment): void {
    this.openComposer({ mode: "new" }, { attachments: [attachment] });
  }

  updateComposerFields(patch: Partial<Pick<ComposerState, "to" | "cc" | "bcc" | "subject">>): void {
    if (!this.state.composer) return;
    this.set({ composer: { ...this.state.composer, ...patch } });
  }

  updateComposerBody(html: string): void {
    if (!this.state.composer) return;
    this.set({ composer: { ...this.state.composer, bodyHtml: html } });
  }

  removeComposerAttachment(index: number): void {
    if (!this.state.composer) return;
    this.set({
      composer: { ...this.state.composer, attachments: this.state.composer.attachments.filter((_, i) => i !== index) },
    });
  }

  addComposerAttachment(attachment: OutgoingAttachment): void {
    if (!this.state.composer) return;
    this.set({ composer: { ...this.state.composer, attachments: [...this.state.composer.attachments, attachment] } });
  }

  /** Asks the host to pick a note and attaches it to the open composer. */
  async requestAttachNote(): Promise<void> {
    const attachment = await this.deps.pickNoteAttachment();
    if (attachment) this.addComposerAttachment(attachment);
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
    if (err instanceof ContactsConsentRequired) {
      return "Contacts access hasn't been granted — use “Grant contacts access” in the Contacts view.";
    }
    if (err instanceof AuthError) {
      return "Reauthentication required — go to Settings → Email and click Re-authenticate.";
    }
    // Graph rejects deleting/renaming its own protected system folders (e.g.
    // "Snoozed") without flagging them as such ahead of time — there's no
    // `wellKnownName` to detect this client-side, so we only find out here.
    if (err instanceof Error && err.message.includes("Distinguished folders cannot be deleted")) {
      return "This is a built-in Outlook folder and can't be deleted.";
    }
    return err instanceof Error ? err.message : String(err);
  }

  private outgoingMessage(c: ComposerState): OutgoingMessage {
    return {
      to: c.to, cc: c.cc, bcc: c.bcc, subject: c.subject,
      bodyHtml: sanitizeEmailHtml(c.bodyHtml, { allowRemote: true }).html,
      ...(c.attachments.length ? { attachments: c.attachments } : {}),
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
      this.set({ composer: null });
      this.deps.showNotice("Sent.");
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
      this.deps.showNotice(this.errorMessage(err));
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
    pastTense: "Deleted" | "Archived" | "Moved",
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
        this.deps.showNotice("Couldn't find any messages in that thread.");
        return;
      }
      const results = await Promise.allSettled(messages.map((m) => action(provider, m.id)));
      const succeededIds = messages.filter((_, i) => results[i].status === "fulfilled").map((m) => m.id);
      const failedCount = results.length - succeededIds.length;
      if (succeededIds.length) await this.deps.cache.deleteMessages(acct, succeededIds);
      if (this.state.openThreadId === threadId) this.closeThread();
      await this.reloadListUnlessSearching();
      if (failedCount > 0) {
        this.deps.showNotice(
          succeededIds.length === 0
            ? `Couldn't ${pastTense.toLowerCase()} this thread.`
            : `${pastTense} ${succeededIds.length} of ${messages.length} messages — ${failedCount} failed.`,
        );
      }
    } catch (err) {
      // The cache reads/writes and the reload can all throw (an IndexedDB
      // failure, say); without this the rejection escapes unhandled and the
      // user is told nothing. Mirrors `actOnMessage`.
      this.deps.showNotice(this.errorMessage(err));
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.actOnThread(threadId, (provider, id) => provider.deleteMessage(id), "Deleted");
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.actOnThread(threadId, (provider, id) => provider.archiveMessage(id), "Archived");
  }

  /** Moves every message in the thread to `destinationMailboxId` (an id from
   *  `state.mailboxes`) — used by both drag-and-drop and the row context
   *  menu's "Move" command. */
  async moveThread(threadId: string, destinationMailboxId: string): Promise<void> {
    await this.actOnThread(threadId, (provider, id) => provider.moveMessage(id, destinationMailboxId), "Moved");
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
      this.deps.showNotice("Couldn't open that draft.");
      return;
    }
    let body: MessageBody;
    try {
      body = await provider.getMessageBody(messageId);
    } catch {
      // Leave the composer untouched: a partial one bound to this draftId
      // would overwrite the draft with whatever it managed to prefill.
      this.deps.showNotice("Couldn't load a message body.");
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
      // An existing draft's attachments (if any) already live on the
      // server; they aren't surfaced here for editing, and updateDraft
      // never touches them, so they simply stay as they are.
      attachments: [],
      sending: false,
      error: null,
      savedSnapshot: null,
    };
    // The loaded draft is itself the "last saved" state to compare against.
    this.set({ mode: "mail", composer: { ...composer, savedSnapshot: snapshotOf(composer) } });
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
        this.deps.showNotice("Message body still loading — try again in a moment.");
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
      this.deps.showNotice("Search is unavailable while offline.");
      return;
    }
    this.set({ loadingList: true });
    try {
      const page = await provider.search(query);
      this.set({
        search: { query, active: true },
        threads: groupThreads(page.items),
        hasMore: false,
        loadingList: false,
      });
    } catch {
      this.set({ loadingList: false });
      this.deps.showNotice("Search failed.");
    }
  }

  async clearSearch(): Promise<void> {
    this.set({ search: { query: "", active: false } });
    await this.reloadList();
  }

  private async loadContacts(accountId: string): Promise<void> {
    const contacts = await this.deps.contactStore.list(accountId);
    if (accountId !== this.state.activeAccountId) return; // stale by the time this resolved
    this.set({ contacts, contactsStatus: this.deps.contactSync.getState(accountId).status });
  }

  /** Switches between the mail and contacts panes. Entering Contacts drops the
   *  composer (like every other navigation — App guards unsaved content) and
   *  refreshes the address book. */
  setMode(mode: "mail" | "contacts"): void {
    if (mode === this.state.mode) return;
    if (mode === "contacts") {
      this.set({ mode, composer: null, contactEdit: null });
      const acct = this.state.activeAccountId;
      if (acct) void this.deps.contactSync.syncAccount(acct, { force: true });
    } else {
      this.set({ mode, contactEdit: null });
    }
  }

  searchContacts(query: string): void {
    this.set({ contactSearch: query });
  }

  selectContact(id: string): void {
    this.set({ selectedContactId: id, contactEdit: null });
  }

  newContact(): void {
    const blank = emptyDraft();
    this.set({ selectedContactId: null, contactEdit: { mode: "new", draft: blank, saved: blank, error: null, saving: false } });
  }

  editContact(id: string): void {
    const contact = this.state.contacts.find((c) => c.id === id);
    if (!contact) return;
    const draft = draftFromContact(contact);
    this.set({
      selectedContactId: id,
      contactEdit: { mode: "edit", contactId: id, draft, saved: draftFromContact(contact), error: null, saving: false },
    });
  }

  updateContactDraft(patch: Partial<ContactDraft>): void {
    const edit = this.state.contactEdit;
    if (!edit) return;
    this.set({ contactEdit: { ...edit, draft: { ...edit.draft, ...patch }, error: null } });
  }

  cancelContactEdit(): void {
    this.set({ contactEdit: null });
  }

  hasUnsavedContactEdit(): boolean {
    const edit = this.state.contactEdit;
    return edit !== null && !sameDraft(edit.draft, edit.saved);
  }

  private contactsFailure(accountId: string, err: unknown): void {
    if (err instanceof ContactsConsentRequired) this.deps.contactSync.markNeedsConsent(accountId);
    this.deps.showNotice(this.errorMessage(err));
  }

  /** Server-first: the cache and view only change once the provider accepted
   *  the write, so a failure never needs a rollback. */
  async saveContact(): Promise<void> {
    const edit = this.state.contactEdit;
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!edit || !acct || !supportsContacts(provider)) return;
    const invalid = validateDraft(edit.draft);
    if (invalid) {
      this.set({ contactEdit: { ...edit, error: invalid } });
      return;
    }
    this.set({ contactEdit: { ...edit, saving: true, error: null } });
    try {
      const after = finalizeDraft(edit.draft);
      let saved: Contact | undefined;
      if (edit.mode === "new") {
        saved = await provider.createContact(after);
      } else {
        const before = this.state.contacts.find((c) => c.id === edit.contactId);
        if (!before || !edit.contactId) throw new Error("That contact no longer exists.");
        // Diff against what the form was seeded from, not the live cache entry:
        // a contactSync change landing mid-edit replaces `state.contacts` with
        // remote values, and diffing against those would send the user's stale
        // copy of fields they never touched, reverting the remote edit.
        const patch = patchBetween(finalizeDraft(edit.saved), after);
        saved = Object.keys(patch).length ? await provider.updateContact(edit.contactId, patch) : before;
      }
      // The cache is best-effort — the next sync reconciles it. The server
      // write is not: reporting a failure here would leave the form open in
      // mode "new", and Saving again would create a *second* contact.
      try {
        await this.deps.contactStore.put(acct, saved);
      } catch {
        // Swallowed deliberately: the write landed server-side.
      }
      if (acct !== this.state.activeAccountId) return;
      this.set({
        contacts: sortContacts([...this.state.contacts.filter((c) => c.id !== saved!.id), saved]),
        selectedContactId: saved.id,
        contactEdit: null,
      });
    } catch (err) {
      if (this.state.contactEdit) this.set({ contactEdit: { ...this.state.contactEdit, saving: false } });
      this.contactsFailure(acct, err);
    }
  }

  async deleteContact(id: string): Promise<void> {
    const acct = this.state.activeAccountId;
    const provider = acct ? this.deps.getProvider(acct) : undefined;
    if (!acct || !supportsContacts(provider)) return;
    try {
      await provider.deleteContact(id);
      // Best-effort, as in saveContact: the contact is gone server-side, so a
      // failure to evict it locally must not look like a failed delete.
      try {
        await this.deps.contactStore.remove(acct, id);
      } catch {
        // Swallowed deliberately: the next sync reconciles the cache.
      }
      if (acct !== this.state.activeAccountId) return;
      this.set({
        contacts: this.state.contacts.filter((c) => c.id !== id),
        selectedContactId: this.state.selectedContactId === id ? null : this.state.selectedContactId,
        contactEdit: this.state.contactEdit?.contactId === id ? null : this.state.contactEdit,
      });
    } catch (err) {
      this.contactsFailure(acct, err);
    }
  }

  /** Opens a new message addressed to the contact (or to one specific address). */
  emailContact(id: string, email?: string): void {
    const contact = this.state.contacts.find((c) => c.id === id);
    if (!contact) return;
    const address = email ?? contact.emails[0]?.email;
    if (!address) {
      this.deps.showNotice("This contact has no email address.");
      return;
    }
    this.openComposer({ mode: "new" }, { to: [{ name: contact.displayName, email: address }] });
  }

  async refreshContacts(): Promise<void> {
    const acct = this.state.activeAccountId;
    if (!acct) return;
    await this.deps.contactSync.syncAccount(acct, { force: true });
    const s = this.deps.contactSync.getState(acct);
    if (s.status === "error" && s.lastError) this.deps.showNotice(`Couldn't refresh contacts: ${s.lastError}`);
  }

  async grantContactsAccess(): Promise<void> {
    const acct = this.state.activeAccountId;
    if (acct) await this.deps.grantContactsAccess(acct);
  }

  /** Composer autocomplete: the active account's contacts matching `query`. */
  suggestRecipients(query: string, exclude: string[] = []): RecipientSuggestion[] {
    return rankSuggestions(this.state.contacts, query, exclude);
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
