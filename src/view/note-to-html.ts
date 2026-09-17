import { App, Component, MarkdownRenderer, TFile } from "obsidian";

/** Renders a note's Markdown to HTML exactly as Obsidian's own reading view
 *  would, by delegating to Obsidian's renderer against a detached element. */
export async function renderNoteToHtml(app: App, file: TFile): Promise<string> {
  const content = await app.vault.cachedRead(file);
  const container = document.createElement("div");
  const component = new Component();
  try {
    await MarkdownRenderer.render(app, content, container, file.path, component);
    return container.innerHTML;
  } finally {
    component.unload();
  }
}
