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

export interface ContextHostDeps {
  http: HttpClient;
  secrets: SecretStore;
  post: HttpPost;
  openExternal: (url: string) => void;
  saveBlob: (blob: Blob, filename: string) => Promise<void>;
  now?: () => number;
}

/**
 * Ruling F: when IndexedDB is unavailable the plugin still runs in a degraded
 * mode — the view reads straight from the provider, with no offline support and
 * no persistence. This literal implements the handful of `MailCache` methods
 * that `ViewModel` and `SyncEngine` actually call.
 */
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
} as unknown as MailCache;

const DEGRADED_CURSORS = {
  async get() { return undefined; },
  async set() {},
  async delete() {},
} as unknown as CursorStore;

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

  async addAccountFlow(input: {
    kind: ProviderKind;
    clientId: string;
    clientSecret?: string;
  }): Promise<AccountConfig> {
    const { account } = await addAccount(input, {
      post: this.host.post,
      secrets: this.host.secrets,
      openBrowser: this.host.openExternal,
      now: this.now,
      genId: () => crypto.randomUUID(),
      fetchProfileEmail: defaultFetchProfileEmail(this.host.http),
    });
    await this.settings.addAccount(account);
    this.rebuildProviders();
    void this.sync.syncAccount(account.id);
    return account;
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
