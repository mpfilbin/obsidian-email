import { PluginSettingTab } from "obsidian";
import type { Plugin } from "obsidian";
import type { PluginContext } from "../plugin-context";
import type { SettingsStore } from "./settings-store";

/**
 * TEMPORARY stub — the real settings UI is Task 28. It only needs to satisfy
 * `addSettingTab(...)` and the `(plugin, ctx, settings)` constructor shape that
 * `main.ts` wires up.
 */
export class EmailSettingTab extends PluginSettingTab {
  constructor(
    plugin: Plugin,
    private ctx: PluginContext,
    private settings: SettingsStore,
  ) {
    super(plugin.app, plugin);
    void this.ctx;
    void this.settings;
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("p", { text: "Email settings — see Task 28" });
  }
}
