import { describe, it, expect, vi, afterEach } from "vitest";
import { Component, MarkdownRenderer } from "obsidian";
import { renderNoteToHtml, stripFrontmatter } from "../../src/view/note-to-html";

afterEach(() => vi.restoreAllMocks());

const note = { path: "Notes/Plan.md", basename: "Plan" } as never;
const fast = { settlePollMs: 1, settleMaxPolls: 20 };
const appWith = (text: string) => ({ vault: { cachedRead: vi.fn(async () => text) } });

describe("stripFrontmatter", () => {
  it("removes a leading YAML frontmatter block", () => {
    expect(stripFrontmatter("---\ntitle: X\ntags: [a]\n---\n# Body\n")).toBe("# Body\n");
    expect(stripFrontmatter("---\r\ntitle: X\r\n---\r\nBody")).toBe("Body");
  });

  it("handles an empty block, a BOM, and `...` as the closing fence", () => {
    expect(stripFrontmatter("---\n---\nBody")).toBe("Body");
    expect(stripFrontmatter("﻿---\na: 1\n---\nBody")).toBe("Body");
    expect(stripFrontmatter("---\na: 1\n...\nBody")).toBe("Body");
  });

  it("leaves a note without frontmatter untouched", () => {
    expect(stripFrontmatter("# Title\n\nbody")).toBe("# Title\n\nbody");
  });

  it("only strips frontmatter at the very start — a later `---` rule is content", () => {
    const md = "Intro\n\n---\n\nAfter the rule\n---\nmore";
    expect(stripFrontmatter(md)).toBe(md);
  });

  it("does not eat the body when the closing fence is missing", () => {
    expect(stripFrontmatter("---\ntitle: X\n# Body, never closed")).toBe("---\ntitle: X\n# Body, never closed");
  });

  it("keeps everything after the closing fence, including later horizontal rules", () => {
    expect(stripFrontmatter("---\na: 1\n---\nOne\n\n---\n\nTwo")).toBe("One\n\n---\n\nTwo");
  });
});

describe("renderNoteToHtml", () => {
  it("renders the note's content through Obsidian's renderer and returns the HTML", async () => {
    const app = appWith("# Title\n\nbody");
    const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_a, _md, el: HTMLElement) => {
      el.innerHTML = "<h1>Title</h1><p>body</p>";
    });
    expect(await renderNoteToHtml(app as never, note, fast)).toBe("<h1>Title</h1><p>body</p>");
    expect(app.vault.cachedRead).toHaveBeenCalledWith(note);
    // Called with the note's own path so relative links/embeds resolve like the reading view.
    expect(render).toHaveBeenCalledWith(app, "# Title\n\nbody", expect.any(HTMLElement), "Notes/Plan.md", expect.anything());
  });

  it("renders the BODY, not the frontmatter — the properties block is never passed to the renderer", async () => {
    const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async () => {});
    await renderNoteToHtml(appWith("---\ntitle: X\n---\n# Heading\n\nParagraph") as never, note, fast);
    expect(render.mock.calls[0][1]).toBe("# Heading\n\nParagraph");
  });

  it("loads the parent component BEFORE rendering — an unloaded parent never starts the renderer's section children", async () => {
    const order: string[] = [];
    vi.spyOn(Component.prototype, "load").mockImplementation(function () { order.push("load"); });
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async () => { order.push("render"); });
    await renderNoteToHtml(appWith("x") as never, note, fast);
    expect(order).toEqual(["load", "render"]);
  });

  it("renders into an attached container, and removes it afterwards", async () => {
    let attachedDuringRender: boolean | undefined;
    let container: HTMLElement | undefined;
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_a, _md, el: HTMLElement) => {
      container = el;
      attachedDuringRender = document.body.contains(el);
      el.innerHTML = "<p>x</p>";
    });
    await renderNoteToHtml(appWith("x") as never, note, fast);
    expect(attachedDuringRender).toBe(true);
    expect(container!.isConnected).toBe(false);
  });

  it("waits for sections the renderer finishes after render() resolves", async () => {
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_a, _md, el: HTMLElement) => {
      el.innerHTML = "<p>first</p>";
      setTimeout(() => { el.innerHTML += "<p>second</p>"; }, 8);
      setTimeout(() => { el.innerHTML += "<p>third</p>"; }, 16);
    });
    expect(await renderNoteToHtml(appWith("x") as never, note, { settlePollMs: 5, settleMaxPolls: 40 }))
      .toBe("<p>first</p><p>second</p><p>third</p>");
  });

  it("stops waiting after the poll cap even if the content keeps changing", async () => {
    let n = 0;
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_a, _md, el: HTMLElement) => {
      const t = setInterval(() => { el.innerHTML = `<p>${++n}</p>`; }, 1);
      setTimeout(() => clearInterval(t), 200);
    });
    await expect(renderNoteToHtml(appWith("x") as never, note, { settlePollMs: 2, settleMaxPolls: 5 })).resolves.toMatch(/<p>\d+<\/p>/);
  });

  it("unloads the component and removes the container even when rendering fails, and propagates the error", async () => {
    const unload = vi.spyOn(Component.prototype, "unload");
    let container: HTMLElement | undefined;
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_a, _md, el: HTMLElement) => {
      container = el;
      throw new Error("render exploded");
    });
    await expect(renderNoteToHtml(appWith("x") as never, note, fast)).rejects.toThrow("render exploded");
    expect(unload).toHaveBeenCalledOnce();
    expect(container!.isConnected).toBe(false);
  });

  it("propagates a read failure without rendering or leaving anything in the document", async () => {
    const app = { vault: { cachedRead: vi.fn(async () => { throw new Error("gone"); }) } };
    const render = vi.spyOn(MarkdownRenderer, "render");
    const before = document.body.children.length;
    await expect(renderNoteToHtml(app as never, note, fast)).rejects.toThrow("gone");
    expect(render).not.toHaveBeenCalled();
    expect(document.body.children.length).toBe(before);
  });
});
