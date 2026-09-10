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

// Chainable stand-ins for the settings DOM builder. They record the handlers
// and values a `display()` pass wires up, so a test can drive the form (e.g.
// change the provider dropdown, then click Connect) without a real DOM.
export class StubComponent {
  inputEl = { type: "" } as { type: string };
  kind = "";
  name = "";
  buttonText = "";
  value: unknown = "";
  options: string[] = [];
  private changeHandlers: Array<(v: never) => unknown> = [];
  private clickHandlers: Array<() => unknown> = [];

  setButtonText(text: string): this { this.buttonText = text; return this; }
  setValue(v: unknown): this { this.value = v; return this; }
  setCta(): this { return this; }
  setWarning(): this { return this; }
  setPlaceholder(): this { return this; }
  addOption(value: string): this { this.options.push(value); return this; }
  onChange(fn: (v: never) => unknown): this { this.changeHandlers.push(fn); return this; }
  onClick(fn: () => unknown): this { this.clickHandlers.push(fn); return this; }

  /** Test driver: simulate the user changing this control. */
  async emitChange(v: unknown): Promise<void> {
    this.value = v;
    for (const fn of [...this.changeHandlers]) await (fn as (x: unknown) => unknown)(v);
  }

  /** Test driver: simulate the user clicking this control. */
  async emitClick(): Promise<void> {
    for (const fn of [...this.clickHandlers]) await fn();
  }
}

/** Every component built since the last `resetSettingStubs()`, in build order. */
export const settingComponents: StubComponent[] = [];

export function resetSettingStubs(): void {
  settingComponents.length = 0;
}

export class Setting {
  private name = "";
  constructor(public containerEl?: unknown) {}
  setName(name: string): this { this.name = name; return this; }
  setDesc(): this { return this; }
  setHeading(): this { return this; }
  private build(kind: string, cb: (c: StubComponent) => unknown): this {
    const c = new StubComponent();
    c.kind = kind;
    c.name = this.name;
    settingComponents.push(c);
    cb(c);
    return this;
  }
  addButton(cb: (c: StubComponent) => unknown): this { return this.build("button", cb); }
  addText(cb: (c: StubComponent) => unknown): this { return this.build("text", cb); }
  addDropdown(cb: (c: StubComponent) => unknown): this { return this.build("dropdown", cb); }
  addToggle(cb: (c: StubComponent) => unknown): this { return this.build("toggle", cb); }
}

export class WorkspaceLeaf {}

// Mirrors Obsidian's `normalizePath`: POSIX separators, collapsed runs, no
// leading/trailing slash, NFC-normalized, with "" folded to the vault root.
export function normalizePath(path: string): string {
  const p = path
    .replace(/[\\/]+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\u00a0|\u202f/g, " ")
    .normalize("NFC");
  return p === "" ? "/" : p;
}

export const requestUrl = async (): Promise<unknown> => ({
  status: 200,
  json: {},
  text: "",
  arrayBuffer: new ArrayBuffer(0),
  headers: {},
});
