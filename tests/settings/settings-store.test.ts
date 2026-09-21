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

  describe("pins", () => {
    it("loads an old data file with no pins as an empty list", async () => {
      const s = await SettingsStore.load(host({ schemaVersion: 1, accounts: [], prefs: {} }));
      expect(s.get().pins).toEqual([]);
      expect(s.pinnedThreadIds("a1").size).toBe(0);
    });

    it("pin / unpin are idempotent, scoped per account, and persisted", async () => {
      const h = host();
      const s = await SettingsStore.load(h);
      await s.pin("a1", "t1");
      await s.pin("a1", "t1");
      await s.pin("a2", "t1");
      expect(s.isPinned("a1", "t1")).toBe(true);
      expect([...s.pinnedThreadIds("a1")]).toEqual(["t1"]);
      expect((h.saved() as { pins: unknown[] }).pins).toHaveLength(2);
      await s.unpin("a1", "t1");
      await s.unpin("a1", "t1");
      expect(s.isPinned("a1", "t1")).toBe(false);
      expect(s.isPinned("a2", "t1")).toBe(true);
    });

    it("records when a thread was pinned", async () => {
      const s = await SettingsStore.load(host());
      const before = Date.now();
      await s.pin("a1", "t1");
      expect(s.get().pins[0].pinnedAt).toBeGreaterThanOrEqual(before);
    });

    it("removing an account drops its pins", async () => {
      const s = await SettingsStore.load(host());
      await s.addAccount(acct("a1"));
      await s.pin("a1", "t1");
      await s.pin("a2", "t9");
      await s.removeAccount("a1");
      expect(s.isPinned("a1", "t1")).toBe(false);
      expect(s.isPinned("a2", "t9")).toBe(true);
    });

    it("reverts the in-memory change and rethrows when persisting fails", async () => {
      let fail = false;
      const s = await SettingsStore.load({
        loadData: async () => null,
        saveData: async () => { if (fail) throw new Error("disk full"); },
      });
      await s.pin("a1", "t1");
      fail = true;
      await expect(s.pin("a1", "t2")).rejects.toThrow("disk full");
      expect(s.isPinned("a1", "t2")).toBe(false);
      await expect(s.unpin("a1", "t1")).rejects.toThrow("disk full");
      expect(s.isPinned("a1", "t1")).toBe(true);
    });

    describe("overlapping mutations", () => {
      /** A host whose saves are async, snapshot what they were given, and fail
       *  on the (1-based) call numbers in `failOn`. */
      function flakyHost(failOn: number[]) {
        let calls = 0;
        let persisted: unknown = null;
        return {
          saved: () => persisted as { pins: Array<{ accountId: string; threadId: string }> },
          loadData: async () => null,
          saveData: async (d: unknown) => {
            const n = ++calls;
            await Promise.resolve();
            if (failOn.includes(n)) throw new Error(`save ${n} failed`);
            persisted = structuredClone(d);
          },
        };
      }

      it("keeps a later pin when an earlier overlapping save fails", async () => {
        const h = flakyHost([1]);
        const s = await SettingsStore.load(h);
        const [first, second] = await Promise.allSettled([s.pin("a1", "t1"), s.pin("a1", "t2")]);
        expect(first.status).toBe("rejected");
        expect(second.status).toBe("fulfilled");
        expect(s.isPinned("a1", "t1")).toBe(false);
        expect(s.isPinned("a1", "t2")).toBe(true);
        expect(h.saved().pins.map((p) => p.threadId)).toEqual(["t2"]);
      });

      it("pins neither thread in memory when both overlapping saves fail", async () => {
        const h = flakyHost([1, 2]);
        const s = await SettingsStore.load(h);
        const results = await Promise.allSettled([s.pin("a1", "t1"), s.pin("a1", "t2")]);
        expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
        expect(s.get().pins).toEqual([]);
      });

      it("applies an overlapping pin and unpin of the same thread in call order", async () => {
        const h = flakyHost([]);
        const s = await SettingsStore.load(h);
        await Promise.all([s.pin("a1", "t1"), s.unpin("a1", "t1")]);
        expect(s.isPinned("a1", "t1")).toBe(false);
        expect(h.saved().pins).toEqual([]);
        // unpin queued behind a pin of a not-yet-pinned thread sees that pin
        await Promise.all([s.unpin("a1", "t2"), s.pin("a1", "t2"), s.unpin("a1", "t2"), s.pin("a1", "t2")]);
        expect(s.isPinned("a1", "t2")).toBe(true);
        expect(h.saved().pins.map((p) => p.threadId)).toEqual(["t2"]);
      });

      it("a rejected call does not block later calls", async () => {
        const h = flakyHost([1]);
        const s = await SettingsStore.load(h);
        await expect(s.pin("a1", "t1")).rejects.toThrow("save 1 failed");
        await s.pin("a1", "t2");
        await s.unpin("a1", "t2");
        await s.pin("a1", "t3");
        expect([...s.pinnedThreadIds("a1")]).toEqual(["t3"]);
        expect(h.saved().pins.map((p) => p.threadId)).toEqual(["t3"]);
      });
    });

    it("drops malformed stored pins on load and keeps valid ones", async () => {
      const valid = { accountId: "a1", threadId: "t1", pinnedAt: 5 };
      const s = await SettingsStore.load(host({
        schemaVersion: 1,
        accounts: [],
        prefs: {},
        pins: [
          valid,
          null,
          "t2",
          { accountId: "a1", pinnedAt: 1 },
          { accountId: "a1", threadId: "t3", pinnedAt: "yesterday" },
          { accountId: "a1", threadId: "t4", pinnedAt: NaN },
          { accountId: 7, threadId: "t5", pinnedAt: 1 },
        ],
      }));
      expect(s.get().pins).toEqual([valid]);
      expect(s.isPinned("a1", "t1")).toBe(true);
      expect(s.pinnedThreadIds("a1").size).toBe(1);
    });
  });
});
