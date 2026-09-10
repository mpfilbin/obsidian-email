import { describe, it, expect, vi } from "vitest";
import { PluginContext } from "../src/plugin-context";
import { SettingsStore } from "../src/settings/settings-store";
import { Logger } from "../src/util/logger";

// plugin-context.ts imports `Notice` from obsidian (Ruling F); the `obsidian`
// module is aliased to tests/stubs/obsidian.ts in vitest.config.ts.

const logger = new Logger("t", { debug: () => false });

function hostDeps() {
  return {
    http: {
      request: vi.fn().mockResolvedValue({
        status: 200,
        json: {},
        text: "{}",
        arrayBuffer: new ArrayBuffer(0),
        headers: {},
      }),
    },
    secrets: {
      getSecret: vi.fn().mockResolvedValue(null),
      setSecret: vi.fn().mockResolvedValue(undefined),
    },
    post: vi.fn().mockResolvedValue({
      status: 200,
      json: { access_token: "a", refresh_token: "r", expires_in: 3600 },
    }),
    openExternal: vi.fn(),
    saveBlob: vi.fn().mockResolvedValue(undefined),
    now: () => 0,
  };
}

describe("PluginContext", () => {
  it("creates cache, sync and view-model", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    expect(ctx.cache).toBeTruthy();
    expect(ctx.sync).toBeTruthy();
    expect(ctx.vm).toBeTruthy();
    ctx.dispose();
  });

  it("rebuildProviders exposes a provider for each configured account", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    await settings.addAccount({ id: "a1", email: "a1@g.com", provider: "gmail", clientId: "c", addedAt: 0 });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    ctx.rebuildProviders();
    expect(ctx.providerFor("a1")?.kind).toBe("gmail");
    ctx.dispose();
  });

  it("rebuildProviders drops providers for removed accounts", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    await settings.addAccount({ id: "a1", email: "a1@g.com", provider: "gmail", clientId: "c", addedAt: 0 });
    await settings.addAccount({ id: "a2", email: "a2@o.com", provider: "ms-graph", clientId: "c", addedAt: 0 });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    expect(ctx.providerFor("a2")?.kind).toBe("ms-graph");
    await settings.removeAccount("a2");
    ctx.rebuildProviders();
    expect(ctx.providerFor("a2")).toBeUndefined();
    expect(ctx.providerFor("a1")).toBeTruthy();
    ctx.dispose();
  });

  it("shares one provider registry between sync and view-model", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    await settings.addAccount({ id: "a1", email: "a1@g.com", provider: "gmail", clientId: "c", addedAt: 0 });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    ctx.rebuildProviders();
    const fromCtx = ctx.providerFor("a1");
    // sync engine resolves providers from the same map
    expect((ctx.sync as unknown as { deps: { getProvider: (id: string) => unknown } }).deps.getProvider("a1")).toBe(fromCtx);
    ctx.dispose();
  });

  it("removeAccountFlow clears secrets, settings and cache", async () => {
    const deps = hostDeps();
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    await settings.addAccount({ id: "a1", email: "a1@g.com", provider: "gmail", clientId: "c", addedAt: 0 });
    const ctx = await PluginContext.create(settings, deps, logger);
    ctx.rebuildProviders();
    await ctx.removeAccountFlow("a1");
    expect(settings.get().accounts).toHaveLength(0);
    expect(deps.secrets.setSecret).toHaveBeenCalledWith("obsidian-email:a1:refresh", "");
    ctx.dispose();
  });

  it("applyPollInterval forwards the configured interval to the sync engine", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    const spy = vi.spyOn(ctx.sync, "setPollInterval");
    ctx.applyPollInterval();
    expect(spy).toHaveBeenCalledWith(settings.pollIntervalMs());
    ctx.dispose();
  });
});
