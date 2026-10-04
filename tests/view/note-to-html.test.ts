import { describe, it, expect, vi, afterEach } from "vitest";
import { MarkdownRenderer } from "obsidian";
import { renderNoteToHtml } from "../../src/view/note-to-html";

afterEach(() => vi.restoreAllMocks());

const note = { path: "Notes/Plan.md", basename: "Plan" } as never;

describe("renderNoteToHtml", () => {
  it("renders the note's cached content through Obsidian's renderer and returns the HTML", async () => {
    const app = { vault: { cachedRead: vi.fn(async () => "# Title\n\nbody") } };
    const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_a, _md, el: HTMLElement) => {
      el.innerHTML = "<h1>Title</h1><p>body</p>";
    });
    const html = await renderNoteToHtml(app as never, note);
    expect(html).toBe("<h1>Title</h1><p>body</p>");
    expect(app.vault.cachedRead).toHaveBeenCalledWith(note);
    // Called with the note's own path so relative links/embeds resolve like the reading view.
    expect(render).toHaveBeenCalledWith(app, "# Title\n\nbody", expect.any(HTMLElement), "Notes/Plan.md", expect.anything());
  });

  it("unloads the render component even when rendering fails, and propagates the error", async () => {
    const app = { vault: { cachedRead: vi.fn(async () => "x") } };
    let component: { unload: () => void } | undefined;
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_a, _md, _el, _p, c: unknown) => {
      component = c as { unload: () => void };
      vi.spyOn(component, "unload");
      throw new Error("render exploded");
    });
    await expect(renderNoteToHtml(app as never, note)).rejects.toThrow("render exploded");
    expect(component!.unload).toHaveBeenCalledOnce();
  });

  it("propagates a read failure without rendering", async () => {
    const app = { vault: { cachedRead: vi.fn(async () => { throw new Error("gone"); }) } };
    const render = vi.spyOn(MarkdownRenderer, "render");
    await expect(renderNoteToHtml(app as never, note)).rejects.toThrow("gone");
    expect(render).not.toHaveBeenCalled();
  });
});
