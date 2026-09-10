// Minimal runtime stub for the `obsidian` module under vitest. The real package
// ships type declarations only (no runtime entry), so any suite that
// transitively imports `obsidian` for a value (e.g. `Notice`) needs this.
// Wired in via `resolve.alias` in vitest.config.ts.

export class Notice {
  message: string;
  constructor(message?: string) {
    this.message = message ?? "";
  }
  setMessage(message: string): this {
    this.message = message;
    return this;
  }
  hide(): void {}
}

export class Events {
  on(): void {}
  off(): void {}
  trigger(): void {}
}

export class Component {
  onload(): void {}
  onunload(): void {}
  load(): void {}
  unload(): void {}
  register(): void {}
  registerEvent(): void {}
}

export class Plugin extends Component {
  app: unknown;
  manifest: unknown;
  constructor(app?: unknown, manifest?: unknown) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  addRibbonIcon(): HTMLElement {
    return {} as HTMLElement;
  }
  addCommand(): void {}
  addSettingTab(): void {}
  registerView(): void {}
  async loadData(): Promise<unknown> {
    return null;
  }
  async saveData(): Promise<void> {}
}

export class View extends Component {}
export class ItemView extends View {
  contentEl = {} as HTMLElement;
  constructor(public leaf?: unknown) {
    super();
  }
}

export class SettingTab {}
export class PluginSettingTab extends SettingTab {
  containerEl = {} as HTMLElement;
  constructor(public app?: unknown, public plugin?: unknown) {
    super();
  }
  display(): void {}
  hide(): void {}
}

// Chainable no-op stand-ins for the settings DOM builder. Only the logic
// handlers (`handleConnect` / `handleClearCache`) are unit-tested; `display()`
// is exercised only in the real Obsidian runtime, so these just need to load
// and chain without throwing.
class StubComponent {
  inputEl = { type: "" } as { type: string };
  setButtonText(): this { return this; }
  setValue(): this { return this; }
  setCta(): this { return this; }
  setWarning(): this { return this; }
  setPlaceholder(): this { return this; }
  addOption(): this { return this; }
  onChange(): this { return this; }
  onClick(): this { return this; }
}

export class Setting {
  constructor(public containerEl?: unknown) {}
  setName(): this { return this; }
  setDesc(): this { return this; }
  setHeading(): this { return this; }
  addButton(cb: (c: StubComponent) => unknown): this { cb(new StubComponent()); return this; }
  addText(cb: (c: StubComponent) => unknown): this { cb(new StubComponent()); return this; }
  addDropdown(cb: (c: StubComponent) => unknown): this { cb(new StubComponent()); return this; }
  addToggle(cb: (c: StubComponent) => unknown): this { cb(new StubComponent()); return this; }
}

export class WorkspaceLeaf {}

export const requestUrl = async (): Promise<unknown> => ({
  status: 200,
  json: {},
  text: "",
  arrayBuffer: new ArrayBuffer(0),
  headers: {},
});
