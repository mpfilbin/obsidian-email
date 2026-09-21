import type { AccountConfig } from "../providers/provider-factory";

export interface Prefs {
  pollMinutes: number | null;
  autoLoadImages: boolean;
  attachmentDir: string | null;
  syncWindowDays: number;
  defaultAccountId: string | null;
  debug: boolean;
  ribbonEnabled: boolean;
  ribbonCollapsedByDefault: boolean;
}

export interface PinnedThread {
  accountId: string;
  /** Graph `conversationId` — stable when the thread is moved or archived. */
  threadId: string;
  pinnedAt: number;
}

export interface PluginSettings {
  schemaVersion: number;
  accounts: AccountConfig[];
  prefs: Prefs;
  pins: PinnedThread[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  schemaVersion: 1,
  accounts: [],
  prefs: {
    pollMinutes: 5,
    autoLoadImages: false,
    attachmentDir: null,
    syncWindowDays: 90,
    defaultAccountId: null,
    debug: false,
    ribbonEnabled: true,
    ribbonCollapsedByDefault: false,
  },
  pins: [],
};

export interface PersistHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

function migrate(raw: unknown): PluginSettings {
  const obj = (raw ?? {}) as Partial<PluginSettings>;
  return {
    schemaVersion: DEFAULT_SETTINGS.schemaVersion,
    accounts: Array.isArray(obj.accounts) ? obj.accounts : [],
    prefs: { ...DEFAULT_SETTINGS.prefs, ...(obj.prefs ?? {}) },
    pins: Array.isArray(obj.pins) ? obj.pins : [],
  };
}

export class SettingsStore {
  private constructor(private host: PersistHost, private settings: PluginSettings) {}

  static async load(host: PersistHost): Promise<SettingsStore> {
    return new SettingsStore(host, migrate(await host.loadData()));
  }

  get(): PluginSettings {
    return structuredClone(this.settings);
  }

  private async persist(): Promise<void> {
    await this.host.saveData(this.settings);
  }

  async addAccount(a: AccountConfig): Promise<void> {
    this.settings.accounts = [...this.settings.accounts.filter((x) => x.id !== a.id), a];
    await this.persist();
  }

  async removeAccount(id: string): Promise<void> {
    this.settings.accounts = this.settings.accounts.filter((x) => x.id !== id);
    if (this.settings.prefs.defaultAccountId === id) this.settings.prefs.defaultAccountId = null;
    this.settings.pins = this.settings.pins.filter((p) => p.accountId !== id);
    await this.persist();
  }

  async updatePrefs(patch: Partial<Prefs>): Promise<void> {
    this.settings.prefs = { ...this.settings.prefs, ...patch };
    await this.persist();
  }

  isPinned(accountId: string, threadId: string): boolean {
    return this.settings.pins.some((p) => p.accountId === accountId && p.threadId === threadId);
  }

  pinnedThreadIds(accountId: string): Set<string> {
    return new Set(this.settings.pins.filter((p) => p.accountId === accountId).map((p) => p.threadId));
  }

  async pin(accountId: string, threadId: string): Promise<void> {
    if (this.isPinned(accountId, threadId)) return;
    await this.mutatePins((pins) => [...pins, { accountId, threadId, pinnedAt: Date.now() }]);
  }

  async unpin(accountId: string, threadId: string): Promise<void> {
    if (!this.isPinned(accountId, threadId)) return;
    await this.mutatePins((pins) => pins.filter((p) => !(p.accountId === accountId && p.threadId === threadId)));
  }

  /** Applies `change`, persists, and puts the previous pins back if persisting
   *  fails — so the UI never shows a pin that isn't actually saved. */
  private async mutatePins(change: (pins: PinnedThread[]) => PinnedThread[]): Promise<void> {
    const previous = this.settings.pins;
    this.settings.pins = change(previous);
    try {
      await this.persist();
    } catch (err) {
      this.settings.pins = previous;
      throw err;
    }
  }

  pollIntervalMs(): number | null {
    const m = this.settings.prefs.pollMinutes;
    return m && m > 0 ? m * 60_000 : null;
  }
}
