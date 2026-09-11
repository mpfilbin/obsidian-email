import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmailSettingTab, handleConnect } from "../../src/settings/settings-tab";
import { resetSettingStubs, settingComponents, type StubComponent } from "../stubs/obsidian";
import type { PluginContext } from "../../src/plugin-context";
import type { SettingsStore } from "../../src/settings/settings-store";
import { DEFAULT_SETTINGS } from "../../src/settings/settings-store";

describe("handleConnect", () => {
  it("returns ok with the new account email on success", async () => {
    const ctx = { addAccountFlow: vi.fn().mockResolvedValue({ email: "new@x.com" }) };
    const r = await handleConnect(ctx as never, { clientId: "c" });
    expect(r).toEqual({ ok: true, message: expect.stringContaining("new@x.com") });
    expect(ctx.addAccountFlow).toHaveBeenCalledWith({ kind: "ms-graph", clientId: "c" });
  });

  it("requires a client ID", async () => {
    const ctx = { addAccountFlow: vi.fn() };
    const r = await handleConnect(ctx as never, { clientId: "  " });
    expect(r.ok).toBe(false);
    expect(ctx.addAccountFlow).not.toHaveBeenCalled();
  });

  it("returns a failure message when the flow throws", async () => {
    const ctx = { addAccountFlow: vi.fn().mockRejectedValue(new Error("state mismatch")) };
    const r = await handleConnect(ctx as never, { clientId: "c" });
    expect(r).toEqual({ ok: false, message: expect.stringContaining("state mismatch") });
  });
});

/** Minimal stand-in for the containerEl Obsidian hands a PluginSettingTab. */
function fakeContainer(): HTMLElement {
  return { empty: () => {}, createEl: () => ({}) } as unknown as HTMLElement;
}

function buildTab(addAccountFlow = vi.fn().mockResolvedValue({ email: "m@x.com" })) {
  const ctx = {
    addAccountFlow,
    sync: { getState: () => ({ accountId: "", status: "idle" }) },
    applyPollInterval: () => {},
    cache: { clearAll: vi.fn() },
    reauthAccount: vi.fn(),
    removeAccountFlow: vi.fn(),
  } as unknown as PluginContext;
  const settings = {
    get: () => structuredClone(DEFAULT_SETTINGS),
    updatePrefs: vi.fn(),
  } as unknown as SettingsStore;
  const plugin = { app: {} } as never;
  const tab = new EmailSettingTab(plugin, ctx, settings);
  (tab as unknown as { containerEl: HTMLElement }).containerEl = fakeContainer();
  return { tab, ctx, addAccountFlow };
}

const find = (pred: (c: StubComponent) => boolean): StubComponent =>
  [...settingComponents].reverse().find(pred)!;

describe("EmailSettingTab — Add account", () => {
  beforeEach(() => resetSettingStubs());

  it("has no provider picker or client-secret field — Microsoft 365 is the only provider", () => {
    const { tab } = buildTab();
    tab.display();
    expect(settingComponents.some((c) => c.kind === "dropdown" && c.name === "Provider")).toBe(false);
    expect(settingComponents.some((c) => c.name === "Client secret")).toBe(false);
  });

  it("connects with the typed Client ID and clears the field on success", async () => {
    const { tab, addAccountFlow } = buildTab();
    tab.display();

    await find((c) => c.kind === "text" && c.name === "Client ID").emitChange("client-123");
    await find((c) => c.kind === "button" && c.buttonText === "Connect").emitClick();

    expect(addAccountFlow).toHaveBeenCalledWith({ kind: "ms-graph", clientId: "client-123" });

    resetSettingStubs();
    tab.display();
    expect(find((c) => c.kind === "text" && c.name === "Client ID").value).toBe("");
  });

  it("keeps the typed Client ID across a re-entrant display() call after a failed Connect", async () => {
    const { tab } = buildTab(vi.fn().mockRejectedValue(new Error("nope")));
    tab.display();
    await find((c) => c.kind === "text" && c.name === "Client ID").emitChange("client-123");
    await find((c) => c.kind === "button" && c.buttonText === "Connect").emitClick();

    resetSettingStubs();
    tab.display();
    expect(find((c) => c.kind === "text" && c.name === "Client ID").value).toBe("client-123");
  });
});
