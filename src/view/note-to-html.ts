import { App, Component, MarkdownRenderer, TFile } from "obsidian";

/** A note's YAML frontmatter (the `---` block on the very first line), if any. */
const FRONTMATTER = /^﻿?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** The note's Markdown without its frontmatter. Properties are note metadata,
 *  not message content — and rendered they become an interactive widget that
 *  means nothing in an email. */
export function stripFrontmatter(markdown: string): string {
  const match = FRONTMATTER.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}

const SETTLE_POLL_MS = 50;
const SETTLE_MAX_POLLS = 40;

/** Resolves once the container's content has stopped changing. Obsidian's
 *  renderer finishes some sections (embeds, code blocks, images, lazily
 *  rendered blocks) after `render()` has already resolved. */
async function settle(container: HTMLElement, pollMs: number, maxPolls: number): Promise<void> {
  let last = container.innerHTML;
  let stable = 0;
  for (let i = 0; i < maxPolls && stable < 2; i++) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const now = container.innerHTML;
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
}

/** Renders a note's Markdown to HTML as Obsidian's own reading view would, by
 *  delegating to Obsidian's renderer.
 *
 *  Two things matter for getting the WHOLE note rather than just its first
 *  block (previously only the frontmatter came out):
 *  - the parent `Component` must be loaded — the renderer's per-section
 *    children only start once their parent has, so with an unloaded parent
 *    just the first section was ever produced;
 *  - the container is attached to the document (invisibly), because rendering
 *    and post-processing assume a live, laid-out element. */
export async function renderNoteToHtml(
  app: App,
  file: TFile,
  opts: { settlePollMs?: number; settleMaxPolls?: number } = {},
): Promise<string> {
  const content = stripFrontmatter(await app.vault.cachedRead(file));
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  container.style.cssText =
    "position:fixed;top:0;left:0;width:800px;opacity:0;pointer-events:none;z-index:-1;";
  document.body.appendChild(container);
  const component = new Component();
  component.load();
  try {
    await MarkdownRenderer.render(app, content, container, file.path, component);
    await settle(container, opts.settlePollMs ?? SETTLE_POLL_MS, opts.settleMaxPolls ?? SETTLE_MAX_POLLS);
    return container.innerHTML;
  } finally {
    component.unload();
    container.remove();
  }
}
