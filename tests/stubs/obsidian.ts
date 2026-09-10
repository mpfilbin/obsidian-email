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

export class WorkspaceLeaf {}

export const requestUrl = async (): Promise<unknown> => ({
  status: 200,
  json: {},
  text: "",
  arrayBuffer: new ArrayBuffer(0),
  headers: {},
});
