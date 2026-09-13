import { Notice } from "obsidian";
import type { HttpClient } from "./providers/http";
import type { HttpPost } from "./auth/oauth-client";
import type { SecretStore } from "./auth/token-manager";
import type { AccountConfig } from "./providers/provider-factory";
import type { MailProvider, ProviderKind } from "./providers/types";
import type { Logger } from "./util/logger";
import type { SettingsStore } from "./settings/settings-store";
import { CursorStore } from "./cache/cursor-store";
import { MailCache } from "./cache/mail-cache";
import { SyncEngine } from "./sync/sync-engine";
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
  saveBlob: (blob: Blob, filename: string) => Promise<void>;
  /** Prompts the user for a vault-relative path and creates a note there. */
  saveNote: (defaultPath: string, content: string) => void;
  now?: () => number;
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
} satisfies Partial<MailCache> as unknown as MailCache;

const DEGRADED_CURSORS = {
  async get() { return undefined; },
  async set() {},
  async delete() {},
} satisfies Partial<CursorStore> as unknown as CursorStore;

export class PluginContext {
  private now: () => number;

  private constructor(
    private settings: SettingsStore,
    private host: ContextHostDeps,
    private logger: Logger,
    readonly cache: MailCache,
    readonly sync: SyncEngine,
    readonly vm: ViewModel,
    private providers: Map<string, MailProvider>,
    private tokens: Map<string, TokenManager>,
    now: () => number,
    readonly degraded: boolean,
  ) {
    this.now = now;
  }

  static async create(
    settings: SettingsStore,
    host: ContextHostDeps,
    logger: Logger,
  ): Promise<PluginContext> {
    const now = host.now ?? (() => Date.now());

    let cache: MailCache = DEGRADED_CACHE;
    let cursors: CursorStore = DEGRADED_CURSORS;
    let degraded = false;
    try {
      cache = await MailCache.open();
      cursors = await CursorStore.open();
    } catch (err) {
      degraded = true;
      logger.error("local cache unavailable; running in degraded mode", (err as Error).message);
      new Notice(
        "Email: local cache is unavailable. Running without offline support or persistence.",
      );
      cache = DEGRADED_CACHE;
      cursors = DEGRADED_CURSORS;
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
    });

    const vm = new ViewModel({
      cache,
      sync,
      settings,
      getProvider: (id) => providers.get(id),
      isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
      openExternal: host.openExternal,
      saveBlob: host.saveBlob,
      saveNote: host.saveNote,
    });

    const ctx = new PluginContext(
      settings, host, logger, cache, sync, vm, providers, tokens, now, degraded,
    );
    ctx.rebuildProviders();
    return ctx;
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
      return { ok: true, message: `Re-authenticated ${refreshed.email}.` };
    } catch (err) {
      return { ok: false, message: `Could not re-authenticate: ${(err as Error).message}` };
    }
  }

  async removeAccountFlow(id: string): Promise<void> {
    await this.tokens.get(id)?.clear();
    await this.settings.removeAccount(id);
    await this.cache.clearAccount(id);
    this.rebuildProviders();
  }

  applyPollInterval(): void {
    this.sync.setPollInterval(this.settings.pollIntervalMs());
  }

  dispose(): void {
    this.sync.stop();
    this.vm.dispose();
  }
}
