import { describe, it, expect } from "vitest";
import { SettingsStore, DEFAULT_SETTINGS } from "../../src/settings/settings-store";

function host(initial: unknown = null) {
  let store = initial;
  return {
    saved: () => store,
    loadData: async () => store,
    saveData: async (d: unknown) => { store = d; },
  };
}

const acct = (id: string) =>
  ({ id, email: `${id}@x.com`, provider: "ms-graph" as const, clientId: "c", addedAt: 1 });

describe("SettingsStore", () => {
  it("returns defaults for an empty vault", async () => {
    const s = await SettingsStore.load(host());
    expect(s.get()).toEqual(DEFAULT_SETTINGS);
  });

  it("adds and removes accounts, persisting each time", async () => {
    const h = host();
    const s = await SettingsStore.load(h);
    await s.addAccount(acct("a1"));
    await s.addAccount(acct("a2"));
    expect(s.get().accounts.map((a) => a.id)).toEqual(["a1", "a2"]);
    await s.removeAccount("a1");
    expect(s.get().accounts.map((a) => a.id)).toEqual(["a2"]);
    expect((h.saved() as { accounts: unknown[] }).accounts).toHaveLength(1);
  });

  it("clears defaultAccountId when that account is removed", async () => {
    const s = await SettingsStore.load(host());
    await s.addAccount(acct("a1"));
    await s.updatePrefs({ defaultAccountId: "a1" });
    await s.removeAccount("a1");
    expect(s.get().prefs.defaultAccountId).toBeNull();
  });

  it("merges partial persisted data onto defaults", async () => {
    const s = await SettingsStore.load(host({ schemaVersion: 0, accounts: [acct("x")] }));
    expect(s.get().prefs.pollMinutes).toBe(DEFAULT_SETTINGS.prefs.pollMinutes);
    expect(s.get().accounts).toHaveLength(1);
    expect(s.get().schemaVersion).toBe(DEFAULT_SETTINGS.schemaVersion);
  });

  it("computes poll interval in ms, or null when manual", async () => {
    const s = await SettingsStore.load(host());
    await s.updatePrefs({ pollMinutes: 5 });
    expect(s.pollIntervalMs()).toBe(300_000);
    await s.updatePrefs({ pollMinutes: null });
    expect(s.pollIntervalMs()).toBeNull();
  });

  it("defaults the ribbon to enabled and expanded, and persists changes", async () => {
    const h = host();
    const s = await SettingsStore.load(h);
    expect(s.get().prefs.ribbonEnabled).toBe(true);
    expect(s.get().prefs.ribbonCollapsedByDefault).toBe(false);
    await s.updatePrefs({ ribbonEnabled: false, ribbonCollapsedByDefault: true });
    const s2 = await SettingsStore.load(h);
    expect(s2.get().prefs.ribbonEnabled).toBe(false);
    expect(s2.get().prefs.ribbonCollapsedByDefault).toBe(true);
  });
});
