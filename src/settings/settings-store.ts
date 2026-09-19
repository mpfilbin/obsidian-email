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

export interface PluginSettings {
  schemaVersion: number;
  accounts: AccountConfig[];
  prefs: Prefs;
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
    await this.persist();
  }

  async updatePrefs(patch: Partial<Prefs>): Promise<void> {
    this.settings.prefs = { ...this.settings.prefs, ...patch };
    await this.persist();
  }

  pollIntervalMs(): number | null {
    const m = this.settings.prefs.pollMinutes;
    return m && m > 0 ? m * 60_000 : null;
  }
}
