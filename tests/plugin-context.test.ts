import { describe, it, expect, vi } from "vitest";
import * as obsidian from "obsidian";
import { PluginContext } from "../src/plugin-context";
import { SettingsStore } from "../src/settings/settings-store";
import { Logger } from "../src/util/logger";
import { MailCache } from "../src/cache/mail-cache";
import { CursorStore } from "../src/cache/cursor-store";
import { ContactCache, MemoryContactStore } from "../src/cache/contact-cache";

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
    promptFolderRename: vi.fn(),
    pickNoteAttachment: vi.fn(),
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

  it("exposes contact sync and store, and startContacts syncs every account", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    await settings.addAccount({ id: "a1", email: "a1@g.com", provider: "ms-graph", clientId: "c", addedAt: 0 });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    const spy = vi.spyOn(ctx.contactSync, "syncAll");
    ctx.startContacts();
    expect(spy).toHaveBeenCalledOnce();
    ctx.dispose();
  });

  it("dispose closes the cache, cursor and contact connections", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    const cache = vi.spyOn(ctx.cache, "close");
    const cursors = vi.spyOn(ctx.cursors, "close");
    const contacts = vi.spyOn(ctx.contactStore, "close");
    ctx.dispose();
    expect(cache).toHaveBeenCalledOnce();
    expect(cursors).toHaveBeenCalledOnce();
    expect(contacts).toHaveBeenCalledOnce();
  });

  it("a hung mail cache open degrades within the timeout, with its own notice", async () => {
    // openWithTimeout turns a never-settling open into a CacheOpenTimeout,
    // which the degraded path reports differently from a plain failure.
    const cacheOpen = vi.spyOn(MailCache, "open").mockReturnValue(new Promise(() => {}));
    const notice = vi.spyOn(obsidian, "Notice").mockImplementation((() => ({})) as never);
    try {
      const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
      const ctx = await PluginContext.create(settings, { ...hostDeps(), cacheOpenTimeoutMs: 20 }, logger);

      expect(ctx.degraded).toBe(true);
      expect(notice).toHaveBeenCalledOnce();
      expect(notice.mock.calls[0][0]).toContain("blocked by an older session");
      ctx.dispose();
    } finally {
      notice.mockRestore();
      cacheOpen.mockRestore();
    }
  });

  describe("contacts database failure degrades only contacts", () => {
    const cases: Array<[string, () => Promise<never>]> = [
      ["hangs", () => new Promise(() => {})],
      ["fails", () => Promise.reject(new Error("contacts idb broke"))],
    ];
    for (const [label, open] of cases) {
      it(`when the contacts open ${label}, mail stays persistent and contacts fall back to memory`, async () => {
        const contactOpen = vi.spyOn(ContactCache, "open").mockImplementation(open);
        const notice = vi.spyOn(obsidian, "Notice").mockImplementation((() => ({})) as never);
        const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
        try {
          const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
          const ctx = await PluginContext.create(settings, { ...hostDeps(), cacheOpenTimeoutMs: 20 }, logger);

          expect(ctx.degraded).toBe(false);
          expect(ctx.cache).toBeInstanceOf(MailCache);
          expect(ctx.cursors).toBeInstanceOf(CursorStore);
          expect(ctx.contactStore).toBeInstanceOf(MemoryContactStore);
          expect(notice).not.toHaveBeenCalled();
          expect(warn).toHaveBeenCalledOnce();
          expect(warn.mock.calls[0][0]).toContain("contacts");

          // Contacts still work, in memory, for the session.
          await ctx.contactStore.put("a1", { id: "1", displayName: "A", emails: [], businessPhones: [], homePhones: [] });
          expect((await ctx.contactStore.list("a1")).map((c) => c.id)).toEqual(["1"]);
          ctx.dispose();
        } finally {
          warn.mockRestore();
          notice.mockRestore();
          contactOpen.mockRestore();
        }
      });
    }
  });

  it("clearLocalCache clears mail and contacts, then re-syncs contacts for every account", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    await settings.addAccount({ id: "a1", email: "a1@g.com", provider: "ms-graph", clientId: "c", addedAt: 0 });
    await settings.addAccount({ id: "a2", email: "a2@g.com", provider: "ms-graph", clientId: "c", addedAt: 0 });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    const person = { id: "1", displayName: "A", emails: [], businessPhones: [], homePhones: [] };
    await ctx.contactStore.put("a1", person);
    await ctx.contactStore.put("a2", person);
    const mailClear = vi.spyOn(ctx.cache, "clearAll");
    const forget = vi.spyOn(ctx.contactSync, "forget");
    const resync = vi.spyOn(ctx.contactSync, "syncAccount").mockResolvedValue();

    await ctx.clearLocalCache();

    expect(mailClear).toHaveBeenCalledOnce();
    expect(await ctx.contactStore.list("a1")).toEqual([]);
    expect(await ctx.contactStore.list("a2")).toEqual([]);
    expect(forget.mock.calls.map((c) => c[0]).sort()).toEqual(["a1", "a2"]);
    expect(resync).toHaveBeenCalledWith("a1", { force: true });
    expect(resync).toHaveBeenCalledWith("a2", { force: true });
    ctx.dispose();
  });

  it("startContacts twice leaves a single interval running", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    await settings.addAccount({ id: "a1", email: "a1@g.com", provider: "ms-graph", clientId: "c", addedAt: 0 });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    vi.useFakeTimers();
    try {
      ctx.startContacts();
      ctx.startContacts();
      const spy = vi.spyOn(ctx.contactSync, "syncAll");
      vi.advanceTimersByTime(15 * 60_000);
      expect(spy).toHaveBeenCalledOnce();
      ctx.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("removeAccountFlow tells contact sync to forget the account first", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    await settings.addAccount({ id: "gone", email: "g@g.com", provider: "ms-graph", clientId: "c", addedAt: 0 });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    const order: string[] = [];
    const forget = vi.spyOn(ctx.contactSync, "forget").mockImplementation(() => { order.push("forget"); });
    vi.spyOn(ctx.contactStore, "clear").mockImplementation(async () => { order.push("clear"); });

    await ctx.removeAccountFlow("gone");

    expect(forget).toHaveBeenCalledWith("gone");
    expect(order).toEqual(["forget", "clear"]);
    ctx.dispose();
  });

  it("removing an account clears its cached contacts", async () => {
    const settings = await SettingsStore.load({ loadData: async () => null, saveData: async () => {} });
    await settings.addAccount({ id: "acct-rm", email: "r@g.com", provider: "ms-graph", clientId: "c", addedAt: 0 });
    const ctx = await PluginContext.create(settings, hostDeps(), logger);
    await ctx.contactStore.put("acct-rm", { id: "1", displayName: "A", emails: [], businessPhones: [], homePhones: [] });
    await ctx.removeAccountFlow("acct-rm");
    expect(await ctx.contactStore.list("acct-rm")).toEqual([]);
    ctx.dispose();
  });
});
