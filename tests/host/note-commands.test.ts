import { describe, it, expect, vi } from "vitest";
import { makeNoteCommands, makePickNoteAttachment, makeResolveNote, type NoteFile } from "../../src/host/note-commands";

const note = (name = "Plan.md", extension = "md"): NoteFile => ({ name, basename: name.replace(/\.[^.]+$/, ""), extension });
const settle = () => new Promise((r) => setTimeout(r, 0));

function host(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const h = {
    activeFile: vi.fn((): NoteFile | null => note()),
    pickNote: vi.fn((onResolve: (f: NoteFile) => void, _c?: () => void) => onResolve(note("Picked.md"))),
    readBinary: vi.fn(async () => new TextEncoder().encode("# hi").buffer as ArrayBuffer),
    renderToHtml: vi.fn(async () => "<h1>hi</h1>"),
    activateView: vi.fn(async () => { calls.push("activate"); }),
    notify: vi.fn(),
    openComposeFromNote: vi.fn(() => { calls.push("compose"); }),
    openComposeWithAttachment: vi.fn(() => { calls.push("attach"); }),
    ...over,
  };
  return { h: h as never, raw: h, calls };
}

describe("resolveNote", () => {
  it("uses the active note without a picker when it's Markdown", () => {
    const { h, raw } = host();
    const onResolve = vi.fn();
    makeResolveNote(h)(onResolve);
    expect(onResolve).toHaveBeenCalledWith(note());
    expect(raw.pickNote).not.toHaveBeenCalled();
  });

  it("opens the picker when the active file isn't Markdown or there's none, passing cancel through", () => {
    for (const active of [note("img.png", "png"), null]) {
      const { h, raw } = host({ activeFile: () => active });
      const onResolve = vi.fn(); const onCancel = vi.fn();
      makeResolveNote(h)(onResolve, onCancel);
      expect(raw.pickNote).toHaveBeenCalledWith(onResolve, onCancel);
    }
  });
});

describe("pickNoteAttachment", () => {
  it("resolves to the chosen note as a base64 text/markdown attachment", async () => {
    const { h } = host();
    expect(await makePickNoteAttachment(h)()).toEqual({
      filename: "Plan.md", mimeType: "text/markdown", contentBytes: Buffer.from("# hi").toString("base64"),
    });
  });

  it("resolves undefined when the picker is cancelled", async () => {
    const { h } = host({ activeFile: () => null, pickNote: (_r: unknown, cancel: () => void) => cancel() });
    expect(await makePickNoteAttachment(h)()).toBeUndefined();
  });

  it("reports a read failure and resolves undefined", async () => {
    const { h, raw } = host({ readBinary: async () => { throw new Error("denied"); } });
    expect(await makePickNoteAttachment(h)()).toBeUndefined();
    expect(raw.notify).toHaveBeenCalledWith('Couldn\'t attach "Plan.md": denied');
  });
});

describe("noteCommands.composeFromNote", () => {
  it("renders the note, shows the mail view, then opens a composer titled with the note's basename", async () => {
    const { h, raw, calls } = host();
    makeNoteCommands(h).composeFromNote();
    await settle();
    expect(raw.renderToHtml).toHaveBeenCalledWith(note());
    expect(raw.openComposeFromNote).toHaveBeenCalledWith("Plan", "<h1>hi</h1>");
    expect(calls).toEqual(["activate", "compose"]);
  });

  it("reports a render failure and opens nothing", async () => {
    const { h, raw } = host({ renderToHtml: async () => { throw new Error("bad md"); } });
    makeNoteCommands(h).composeFromNote();
    await settle();
    expect(raw.notify).toHaveBeenCalledWith('Couldn\'t create an email from "Plan": bad md');
    expect(raw.openComposeFromNote).not.toHaveBeenCalled();
    expect(raw.activateView).not.toHaveBeenCalled();
  });
});

describe("noteCommands.composeWithNoteAttached", () => {
  it("shows the mail view and opens a composer with the note attached", async () => {
    const { h, raw, calls } = host();
    makeNoteCommands(h).composeWithNoteAttached();
    await settle();
    expect(raw.openComposeWithAttachment).toHaveBeenCalledWith({
      filename: "Plan.md", mimeType: "text/markdown", contentBytes: Buffer.from("# hi").toString("base64"),
    });
    expect(calls).toEqual(["activate", "attach"]);
  });

  it("reports a read failure and opens nothing", async () => {
    const { h, raw } = host({ readBinary: async () => { throw new Error("denied"); } });
    makeNoteCommands(h).composeWithNoteAttached();
    await settle();
    expect(raw.notify).toHaveBeenCalledWith('Couldn\'t attach "Plan.md": denied');
    expect(raw.openComposeWithAttachment).not.toHaveBeenCalled();
  });

  it("uses the picker for a non-Markdown active file", async () => {
    const { h, raw } = host({ activeFile: () => null });
    makeNoteCommands(h).composeWithNoteAttached();
    await settle();
    expect(raw.pickNote).toHaveBeenCalledOnce();
    expect(raw.openComposeWithAttachment).toHaveBeenCalledWith(expect.objectContaining({ filename: "Picked.md" }));
  });
});
