import { Plugin } from "obsidian";

export default class EmailPlugin extends Plugin {
  async onload(): Promise<void> {
    console.log("obsidian-email: loaded");
  }

  onunload(): void {
    console.log("obsidian-email: unloaded");
  }
}
