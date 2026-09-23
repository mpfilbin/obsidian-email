import { Notice } from "obsidian";
import type { HttpClient } from "./providers/http";
import type { HttpPost } from "./auth/oauth-client";
import type { SecretStore } from "./auth/token-manager";
import type { AccountConfig } from "./providers/provider-factory";
import type { MailProvider, OutgoingAttachment, ProviderKind } from "./providers/types";
import type { Logger } from "./util/logger";
import type { SettingsStore } from "./settings/settings-store";
import { CursorStore } from "./cache/cursor-store";
import { MailCache } from "./cache/mail-cache";
import { ContactCache, MemoryContactStore, type ContactStore } from "./cache/contact-cache";
import { CacheOpenTimeout, openWithTimeout } from "./cache/open-with-timeout";
import { SyncEngine } from "./sync/sync-engine";
import { ContactSync } from "./sync/contact-sync";
import { ViewModel } from "./view/view-model";
import { TokenManager } from "./auth/token-manager";
import { createProvider } from "./providers/provider-factory";
import { addAccount, defaultFetchProfileEmail } from "./auth/add-account";
import type { AddAccountDeps, LoopbackLike } from "./auth/add-account";

export interface ContextHostDeps {
  http: HttpClient;
  secrets: SecretStore;
  post: HttpPost;
  openExternal: (url: string) => void;
  /** Opens a link clicked in an email body — routes through Obsidian's Web
   *  Viewer when it's enabled, else falls back to `openExternal`. */
  openEmailLink: (url: string) => void;
  saveBlob: (blob: Blob, filename: string) => Promise<void>;
  /** Prompts the user for a vault-relative path and creates a note there. */
  saveNote: (defaultPath: string, content: string) => void;
  /** Prompts the user for a new folder name. */
  promptFolderName: (onSubmit: (name: string) => void) => void;
  /** Prompts for a folder's new name, pre-filled. */
  promptFolderRename: (currentName: string, onSubmit: (name: string) => void) => void;
  /** Picks a vault note and reads it as an attachment. */
  pickNoteAttachment: () => Promise<OutgoingAttachment | undefined>;
  /** Shows a transient, auto-dismissing toast. */
  showNotice: (message: string) => void;
  now?: () => number;
  /** Test-only seam: how long each IndexedDB open may take before the plugin
   *  gives up and degrades. Defaults to `CACHE_OPEN_TIMEOUT_MS`. */
  cacheOpenTimeoutMs?: number;
  /** Test-only seam: lets a spec inject a fake OAuth loopback server. */
  makeLoopback?: (host: "127.0.0.1" | "localhost") => LoopbackLike;
}

/**
 * Ruling F: when IndexedDB is unavailable the plugin still runs in a degraded
 * mode — the view reads straight from the provider, with no offline support and
 * no persistence. This literal implements the handful of `MailCache` methods
 * that `ViewModel` and `SyncEngine` actually call.
 */
// `satisfies Partial<…>` keeps the shims honest: a renamed cache method or a
// drifted signature fails to compile here. (Catching a *new* consumer-called
// method would need the consumers to accept a narrower type — out of scope.)
const DEGRADED_CACHE = {
  async getMailboxes() { return []; },
  async putMailboxes() {},
  async upsertMessages() {},
  async deleteMessages() {},
  async listMailboxMessages() { return []; },
  async getThreadMessages() { return []; },
  async getBody() { return undefined; },
  async putBody() {},
  async pruneAccount() {},
  async clearAccount() {},
  async clearAll() {},
  close() {},
} satisfies Partial<MailCache> as unknown as MailCache;

const DEGRADED_CURSORS = {
  async get() { return undefined; },
  async set() {},
  async delete() {},
  close() {},
} satisfies Partial<CursorStore> as unknown as CursorStore;

const CONTACT_POLL_MS = 15 * 60_000;

/** How long to wait for each IndexedDB open before giving up and degrading.
 *  An open blocked by an older connection never settles on its own. */
const CACHE_OPEN_TIMEOUT_MS = 8000;

export class PluginContext {
  private now: () => number;
  private contactTimer?: ReturnType<typeof setInterval>;

  private constructor(
    private settings: SettingsStore,
    private host: ContextHostDeps,
    private logger: Logger,
    readonly cache: MailCache,
    readonly cursors: CursorStore,
    readonly sync: SyncEngine,
    readonly vm: ViewModel,
    private providers: Map<string, MailProvider>,
    private tokens: Map<string, TokenManager>,
    now: () => number,
    readonly degraded: boolean,
    readonly contactSync: ContactSync,
    readonly contactStore: ContactStore,
  ) {
    this.now = now;
  }

  static async create(
    settings: SettingsStore,
    host: ContextHostDeps,
    logger: Logger,
  ): Promise<PluginContext> {
    const now = host.now ?? (() => Date.now());
    const openTimeoutMs = host.cacheOpenTimeoutMs ?? CACHE_OPEN_TIMEOUT_MS;

    let cache: MailCache = DEGRADED_CACHE;
    let cursors: CursorStore = DEGRADED_CURSORS;
    let contactStore: ContactStore = new MemoryContactStore();
    let degraded = false;
    try {
      // A blocked open (an older plugin instance holding the database in this
      // renderer) makes `openDB` hang rather than throw, which would leave
      // `create` pending forever — no view, no commands, no error. The timeout
      // turns that into the ordinary degraded path.
      cache = await openWithTimeout(() => MailCache.open(), openTimeoutMs);
      cursors = await openWithTimeout(() => CursorStore.open(), openTimeoutMs);
    } catch (err) {
      degraded = true;
      logger.error("local cache unavailable; running in degraded mode", (err as Error).message);
      // Release anything that did open before the failure — a live handle
      // would itself block the retry after a restart.
      cache.close();
      cursors.close();
      new Notice(
        err instanceof CacheOpenTimeout
          ? "Email: the local cache is busy or blocked by an older session. Restart Obsidian to reconnect it; running without persistence until then."
          : "Email: local cache is unavailable. Running without offline support or persistence.",
      );
      cache = DEGRADED_CACHE;
      cursors = DEGRADED_CURSORS;
    }
    // Contacts live in their own database, so a problem there must not degrade
    // mail (and vice versa): fall back to an in-memory store, quietly.
    try {
      contactStore = await openWithTimeout(() => ContactCache.open(), openTimeoutMs);
    } catch (err) {
      logger.warn("contacts cache unavailable; keeping contacts in memory for this session", (err as Error).message);
    }

    // One shared provider registry backs both the sync engine and the view model.
    const providers = new Map<string, MailProvider>();
    const tokens = new Map<string, TokenManager>();

    const sync = new SyncEngine({
      cache,
      cursors,
      logger,
      now,
      getProvider: (id) => providers.get(id),
      listAccountIds: () => settings.get().accounts.map((a) => a.id),
      getPinnedThreadIds: (id) => settings.pinnedThreadIds(id),
    });

    const contactSync = new ContactSync({
      store: contactStore,
      logger,
      now,
      getProvider: (id) => providers.get(id),
      listAccountIds: () => settings.get().accounts.map((a) => a.id),
    });
    // The view-model needs the context (to re-run OAuth) but is built first.
    const ctxRef: { current?: PluginContext } = {};

    const vm = new ViewModel({
      cache,
      sync,
      contactStore,
      contactSync,
      grantContactsAccess: async (accountId) => {
        // reauthAccount requests the full scope list (now incl. Contacts) and
        // force-syncs contacts on success.
        const result = await ctxRef.current!.reauthAccount(accountId);
        host.showNotice(result.message);
      },
      settings,
      getProvider: (id) => providers.get(id),
      isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
      openExternal: host.openEmailLink,
      saveBlob: host.saveBlob,
      saveNote: host.saveNote,
      promptFolderName: host.promptFolderName,
      promptFolderRename: host.promptFolderRename,
      pickNoteAttachment: host.pickNoteAttachment,
      showNotice: host.showNotice,
    });

    const ctx = new PluginContext(
      settings, host, logger, cache, cursors, sync, vm, providers, tokens, now, degraded, contactSync, contactStore,
    );
    ctxRef.current = ctx;
    ctx.rebuildProviders();
    return ctx;
  }

  /** Syncs contacts now, then on a slow timer (each sync is also throttled). */
  startContacts(): void {
    // Idempotent: a second call replaces the timer instead of stacking one.
    if (this.contactTimer) clearInterval(this.contactTimer);
    void this.contactSync.syncAll();
    this.contactTimer = setInterval(() => void this.contactSync.syncAll(), CONTACT_POLL_MS);
  }

  providerFor(id: string): MailProvider | undefined {
    return this.providers.get(id);
  }

  /** Recreate one `TokenManager` + `MailProvider` per configured account. */
  rebuildProviders(): void {
    const accounts = this.settings.get().accounts;
    const keep = new Set(accounts.map((a) => a.id));
    for (const id of [...this.providers.keys()]) {
      if (!keep.has(id)) {
        this.providers.delete(id);
        this.tokens.delete(id);
      }
    }
    for (const a of accounts) {
      const token =
        this.tokens.get(a.id) ??
        new TokenManager(a.id, a.provider, a.clientId, {
          secrets: this.host.secrets,
          post: this.host.post,
          now: this.now,
        });
      this.tokens.set(a.id, token);
      this.providers.set(a.id, createProvider(a, token, this.host.http));
    }
  }

  /** Shared `addAccount` deps; `genId` decides new-id (add) vs reuse-id (re-auth). */
  private addAccountDeps(genId: () => string): AddAccountDeps {
    return {
      post: this.host.post,
      secrets: this.host.secrets,
      openBrowser: this.host.openExternal,
      now: this.now,
      genId,
      fetchProfileEmail: defaultFetchProfileEmail(this.host.http),
      makeLoopback: this.host.makeLoopback,
    };
  }

  async addAccountFlow(input: {
    kind: ProviderKind;
    clientId: string;
  }): Promise<AccountConfig> {
    const { account } = await addAccount(
      input,
      this.addAccountDeps(() => crypto.randomUUID()),
    );
    await this.settings.addAccount(account);
    this.rebuildProviders();
    void this.sync.syncAccount(account.id);
    void this.contactSync.syncAccount(account.id, { force: true });
    return account;
  }

  /**
   * Per-account "Re-authenticate": re-runs the OAuth flow reusing the existing
   * account id and client id, so `settings.addAccount` replaces the record in
   * place instead of creating a duplicate.
   */
  async reauthAccount(accountId: string): Promise<{ ok: boolean; message: string }> {
    const account = this.settings.get().accounts.find((a) => a.id === accountId);
    if (!account) return { ok: false, message: "Account not found." };
    try {
      const { account: refreshed } = await addAccount(
        { kind: account.provider, clientId: account.clientId },
        this.addAccountDeps(() => accountId),
      );
      await this.settings.addAccount(refreshed);
      this.rebuildProviders();
      void this.sync.syncAccount(accountId);
      void this.contactSync.syncAccount(accountId, { force: true });
      return { ok: true, message: `Re-authenticated ${refreshed.email}.` };
    } catch (err) {
      return { ok: false, message: `Could not re-authenticate: ${(err as Error).message}` };
    }
  }

  async removeAccountFlow(id: string): Promise<void> {
    await this.tokens.get(id)?.clear();
    await this.settings.removeAccount(id);
    // Before clearing: a contact sync already past `listContacts()` would
    // otherwise write the removed account's contacts straight back in.
    this.contactSync.forget(id);
    await this.cache.clearAccount(id);
    await this.contactStore.clear(id);
    this.rebuildProviders();
  }

  /**
   * Settings "Clear local cache": empties the mail cache and the contact
   * cache, then re-pulls contacts (the throttle would otherwise leave the
   * address book empty for up to 15 minutes). Mail re-syncs on its own from
   * the cleared cursors, as before.
   */
  async clearLocalCache(): Promise<void> {
    const accountIds = this.settings.get().accounts.map((a) => a.id);
    // Before clearing, like removeAccountFlow: a sync already past
    // `listContacts()` would otherwise write straight back into the store.
    for (const id of accountIds) this.contactSync.forget(id);
    await this.cache.clearAll();
    await this.contactStore.clearAll();
    for (const id of accountIds) void this.contactSync.syncAccount(id, { force: true });
  }

  applyPollInterval(): void {
    this.sync.setPollInterval(this.settings.pollIntervalMs());
  }

  dispose(): void {
    this.sync.stop();
    if (this.contactTimer) clearInterval(this.contactTimer);
    this.vm.dispose();
    // Leaving these open would block the next version's upgrade when the
    // plugin is disabled/enabled in place (same renderer, no GC in between).
    this.cache.close();
    this.cursors.close();
    this.contactStore.close();
  }
}
