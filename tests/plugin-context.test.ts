import { describe, it, expect, vi } from "vitest";
import * as obsidian from "obsidian";
import { PluginContext } from "../src/plugin-context";
import { SettingsStore } from "../src/settings/settings-store";
import { Logger } from "../src/util/logger";
import { MailCache } from "../src/cache/mail-cache";
import { CursorStore } from "../src/cache/cursor-store";

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
    saveNote: vi.fn(),
    promptFolderName: vi.fn(),
    showNotice: vi.fn(),
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
    await settings.addAccount({ id: "a1", email: "a1@g.com", provider: "ms-graph", clientId: "c", addedAt: 0 });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    ctx.rebuildProviders();
    expect(ctx.providerFor("a1")?.kind).toBe("ms-graph");
    ctx.dispose();
  });

  it("rebuildProviders drops providers for removed accounts", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    await settings.addAccount({ id: "a1", email: "a1@g.com", provider: "ms-graph", clientId: "c", addedAt: 0 });
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
    await settings.addAccount({ id: "a1", email: "a1@g.com", provider: "ms-graph", clientId: "c", addedAt: 0 });
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
    await settings.addAccount({ id: "a1", email: "a1@g.com", provider: "ms-graph", clientId: "c", addedAt: 0 });
    const ctx = await PluginContext.create(settings, deps, logger);
    ctx.rebuildProviders();
    await ctx.removeAccountFlow("a1");
    expect(settings.get().accounts).toHaveLength(0);
    expect(deps.secrets.setSecret).toHaveBeenCalledWith("obsidian-email-a1-refresh", "");
    ctx.dispose();
  });

  it("Ruling F: survives an unavailable local cache in degraded mode", async () => {
    const cacheOpen = vi
      .spyOn(MailCache, "open")
      .mockRejectedValueOnce(new Error("idb blocked"));
    const cursorOpen = vi
      .spyOn(CursorStore, "open")
      .mockRejectedValueOnce(new Error("idb blocked"));
    const notice = vi.spyOn(obsidian, "Notice").mockImplementation((() => ({})) as never);

    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    await settings.addAccount({ id: "a1", email: "a1@g.com", provider: "ms-graph", clientId: "c", addedAt: 0 });

    let ctx!: PluginContext;
    await expect(
      (async () => {
        ctx = await PluginContext.create(settings, hostDeps(), logger);
      })(),
    ).resolves.toBeUndefined();

    expect(ctx.degraded).toBe(true);
    expect(notice).toHaveBeenCalledTimes(1);

    // vm and sync are still constructed and usable against the degraded shims.
    expect(ctx.vm.getState()).toBeTruthy();
    expect(ctx.sync.getState("x")).toBeTruthy();
    await expect(ctx.vm.selectMailbox("INBOX")).resolves.toBeUndefined();

    ctx.dispose();
    notice.mockRestore();
    cacheOpen.mockRestore();
    cursorOpen.mockRestore();
  });

  it("reauthAccount refreshes in place, reusing the account id", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    await settings.addAccount({ id: "acct-1", email: "old@x.com", provider: "ms-graph", clientId: "cid", addedAt: 0 });

    const captured = { state: "" };
    const deps = {
      ...hostDeps(),
      http: {
        request: vi.fn().mockResolvedValue({
          status: 200,
          json: { mail: "new@x.com" },
          text: "{}",
          arrayBuffer: new ArrayBuffer(0),
          headers: {},
        }),
      },
      post: vi.fn().mockResolvedValue({
        status: 200,
        json: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
      }),
      openExternal: vi.fn((url: string) => {
        captured.state = new URL(url).searchParams.get("state")!;
      }),
      makeLoopback: () => ({
        listen: async () => ({ port: 1, redirectUri: "http://localhost:1" }),
        waitForCode: async () => ({ code: "C", state: captured.state }),
        close: vi.fn(),
      }),
    };

    const ctx = await PluginContext.create(settings, deps, logger);
    const syncSpy = vi.spyOn(ctx.sync, "syncAccount");

    const r = await ctx.reauthAccount("acct-1");

    expect(r).toEqual({ ok: true, message: expect.stringContaining("new@x.com") });
    // no duplicate — same id replaced in place
    expect(settings.get().accounts).toHaveLength(1);
    expect(settings.get().accounts[0].id).toBe("acct-1");
    expect(settings.get().accounts[0].email).toBe("new@x.com");
    expect(syncSpy).toHaveBeenCalledWith("acct-1");
    ctx.dispose();
  });

  it("reauthAccount reports an unknown account", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    expect(await ctx.reauthAccount("missing")).toEqual({ ok: false, message: "Account not found." });
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
