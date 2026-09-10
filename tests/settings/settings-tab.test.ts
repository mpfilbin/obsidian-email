import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmailSettingTab, handleConnect } from "../../src/settings/settings-tab";
import { resetSettingStubs, settingComponents, type StubComponent } from "../stubs/obsidian";
import type { PluginContext } from "../../src/plugin-context";
import type { SettingsStore } from "../../src/settings/settings-store";
import { DEFAULT_SETTINGS } from "../../src/settings/settings-store";

describe("handleConnect", () => {
  it("returns ok with the new account email on success", async () => {
    const ctx = { addAccountFlow: vi.fn().mockResolvedValue({ email: "new@x.com" }) };
    const r = await handleConnect(ctx as never, { kind: "gmail", clientId: "c", clientSecret: "s" });
    expect(r).toEqual({ ok: true, message: expect.stringContaining("new@x.com") });
  });

  it("requires a client secret for Google", async () => {
    const ctx = { addAccountFlow: vi.fn() };
    const r = await handleConnect(ctx as never, { kind: "gmail", clientId: "c" });
    expect(r.ok).toBe(false);
    expect(ctx.addAccountFlow).not.toHaveBeenCalled();
  });

  it("does not require a secret for Microsoft", async () => {
    const ctx = { addAccountFlow: vi.fn().mockResolvedValue({ email: "m@x.com" }) };
    const r = await handleConnect(ctx as never, { kind: "ms-graph", clientId: "c" });
    expect(r.ok).toBe(true);
  });

  it("returns a failure message when the flow throws", async () => {
    const ctx = { addAccountFlow: vi.fn().mockRejectedValue(new Error("state mismatch")) };
    const r = await handleConnect(ctx as never, { kind: "ms-graph", clientId: "c" });
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

describe("EmailSettingTab — display() re-entrancy", () => {
  beforeEach(() => resetSettingStubs());

  it("keeps the selected provider across the display() re-entry the dropdown triggers", async () => {
    const { tab, addAccountFlow } = buildTab();
    tab.display();

    const provider = find((c) => c.kind === "dropdown" && c.options.includes("ms-graph"));
    // onChange re-enters display(); the rebuilt dropdown must come back with
    // "ms-graph" selected rather than snapping back to the Google default.
    resetSettingStubs();
    await provider.emitChange("ms-graph");
    expect(find((c) => c.kind === "dropdown" && c.options.includes("ms-graph")).value).toBe("ms-graph");

    // Microsoft 365 has no client-secret field, so Client ID alone must connect.
    await find((c) => c.kind === "text" && c.name === "Client ID").emitChange("client-123");
    await find((c) => c.kind === "button" && c.buttonText === "Connect").emitClick();

    expect(addAccountFlow).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ms-graph", clientId: "client-123" }),
    );
  });

  it("hides the client-secret field for Microsoft and shows it for Google", async () => {
    const { tab } = buildTab();
    tab.display();
    expect(settingComponents.some((c) => c.name === "Client secret")).toBe(true);

    const provider = find((c) => c.kind === "dropdown" && c.options.includes("ms-graph"));
    resetSettingStubs();
    await provider.emitChange("ms-graph");
    expect(settingComponents.some((c) => c.name === "Client secret")).toBe(false);
  });
});
