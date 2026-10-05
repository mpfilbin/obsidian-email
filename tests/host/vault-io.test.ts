import { describe, it, expect, vi, afterEach } from "vitest";
import { downloadBlob, ensureFolder, makeSaveBlob, makeSaveNote, readNoteAttachment } from "../../src/host/vault-io";
import { normalizePath } from "obsidian";

afterEach(() => vi.restoreAllMocks());

const memAdapter = (existing: string[] = []) => {
  const files = new Set(existing);
  return {
    files,
    exists: vi.fn(async (p: string) => files.has(p)),
    writeBinary: vi.fn(async (p: string) => { files.add(p); }),
  };
};
// jsdom's Blob has no arrayBuffer(); a minimal stand-in is enough here.
const blob = (text = "hello"): Blob =>
  ({ arrayBuffer: async () => new TextEncoder().encode(text).buffer }) as unknown as Blob;

describe("makeSaveBlob", () => {
  const host = (over: Record<string, unknown> = {}) => {
    const adapter = memAdapter();
    const notify = vi.fn();
    const download = vi.fn();
    return { adapter, notify, download, h: { getAttachmentDir: () => "Attachments", adapter, normalizePath, notify, download, ...over } };
  };

  it("downloads through the browser when no attachment folder is configured", async () => {
    for (const dir of [undefined, null, ""]) {
      const { h, download, adapter } = host({ getAttachmentDir: () => dir });
      const b = blob();
      await makeSaveBlob(h as never)(b, "r.pdf");
      expect(download).toHaveBeenCalledWith(b, "r.pdf");
      expect(adapter.writeBinary).not.toHaveBeenCalled();
    }
  });

  it("writes into the configured folder under the file's own name", async () => {
    const { h, adapter, download } = host();
    await makeSaveBlob(h as never)(blob("abc"), "Report.pdf");
    expect(adapter.writeBinary.mock.calls[0][0]).toBe("Attachments/Report.pdf");
    expect(Array.from(new Uint8Array(adapter.writeBinary.mock.calls[0][1] as ArrayBuffer))).toEqual([97, 98, 99]);
    expect(download).not.toHaveBeenCalled();
  });

  it("never overwrites: a name that exists gets a numeric suffix", async () => {
    const { h, adapter } = host();
    adapter.files.add("Attachments/Report.pdf");
    const save = makeSaveBlob(h as never);
    await save(blob(), "Report.pdf");
    await save(blob(), "Report.pdf");
    expect(adapter.writeBinary.mock.calls.map((c) => c[0])).toEqual(["Attachments/Report (1).pdf", "Attachments/Report (2).pdf"]);
  });

  it("neutralises a hostile filename so it stays inside the folder", async () => {
    const { h, adapter } = host();
    await makeSaveBlob(h as never)(blob(), "../../.obsidian/plugins/evil.js");
    expect(adapter.writeBinary.mock.calls[0][0]).toBe("Attachments/evil.js");
  });

  it("refuses, and tells the user, when the path would land outside the folder", async () => {
    const { h, adapter, notify } = host({ normalizePath: () => "elsewhere/x.pdf" });
    await makeSaveBlob(h as never)(blob(), "x.pdf");
    expect(adapter.writeBinary).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Refused to save "x.pdf" outside the attachment folder.');
  });

  it("reads the folder setting at call time, so a settings change applies immediately", async () => {
    let dir: string | undefined;
    const { h, adapter, download } = host({ getAttachmentDir: () => dir });
    const save = makeSaveBlob(h as never);
    await save(blob(), "a.txt");
    expect(download).toHaveBeenCalledOnce();
    dir = "Mail";
    await save(blob(), "a.txt");
    expect(adapter.writeBinary.mock.calls[0][0]).toBe("Mail/a.txt");
  });
});

describe("downloadBlob", () => {
  it("clicks a temporary anchor with a sanitised download name, then cleans up", () => {
    vi.useFakeTimers();
    try {
      const createObjectURL = vi.fn(() => "blob:x");
      const revokeObjectURL = vi.fn();
      vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
      let clicked: HTMLAnchorElement | undefined;
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked = this; });
      downloadBlob(blob(), "../evil/name.pdf");
      expect(clicked?.download).toBe("name.pdf");
      expect(clicked?.href).toContain("blob:x");
      expect(document.querySelector("a[download]")).toBeNull();
      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:x");
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe("ensureFolder", () => {
  const vault = (existing: string[] = []) => {
    const set = new Set(existing);
    return {
      created: [] as string[],
      adapter: { exists: async (p: string) => set.has(p) },
      createFolder: vi.fn(async function (this: unknown, p: string) { set.add(p); }),
    };
  };

  it("creates each missing segment, parents first", async () => {
    const v = vault();
    await ensureFolder(v, "Mail/2026/Oct");
    expect(v.createFolder.mock.calls.map((c) => c[0])).toEqual(["Mail", "Mail/2026", "Mail/2026/Oct"]);
  });

  it("skips segments that already exist", async () => {
    const v = vault(["Mail", "Mail/2026"]);
    await ensureFolder(v, "Mail/2026/Oct");
    expect(v.createFolder.mock.calls.map((c) => c[0])).toEqual(["Mail/2026/Oct"]);
  });

  it("does nothing for the vault root or an empty path", async () => {
    const v = vault();
    await ensureFolder(v, "");
    await ensureFolder(v, "/");
    expect(v.createFolder).not.toHaveBeenCalled();
  });
});

describe("makeSaveNote", () => {
  const setup = (over: Record<string, unknown> = {}) => {
    const created: Array<[string, string]> = [];
    const folders: string[] = [];
    const notify = vi.fn();
    const openNote = vi.fn(async () => {});
    let confirm!: (path: string) => Promise<void>;
    const host = {
      vault: {
        adapter: { exists: async () => false },
        createFolder: async (p: string) => { folders.push(p); },
        create: async (p: string, c: string) => { created.push([p, c]); return { basename: p.split("/").pop()!.replace(/\.md$/, "") }; },
      },
      askPath: vi.fn((_d: string, cb: (p: string) => Promise<void>) => { confirm = cb; }),
      openNote, notify, ...over,
    };
    return { save: makeSaveNote(host as never), host, created, folders, notify, openNote, confirm: (p: string) => confirm(p) };
  };

  it("asks for a path with the default, then creates parent folders and the note, announces and opens it", async () => {
    const s = setup();
    s.save("Emails/Hello.md", "# body");
    expect(s.host.askPath).toHaveBeenCalledWith("Emails/Hello.md", expect.any(Function));
    expect(s.created).toEqual([]); // nothing until the user confirms
    await s.confirm("Emails/2026/Hello.md");
    expect(s.folders).toEqual(["Emails", "Emails/2026"]);
    expect(s.created).toEqual([["Emails/2026/Hello.md", "# body"]]);
    expect(s.notify).toHaveBeenCalledWith('Saved "Hello".');
    expect(s.openNote).toHaveBeenCalledWith({ basename: "Hello" });
  });

  it("reports a failure instead of throwing", async () => {
    const s = setup({ vault: { adapter: { exists: async () => false }, createFolder: async () => {}, create: async () => { throw new Error("exists"); } } });
    s.save("a.md", "x");
    await s.confirm("a.md");
    expect(s.notify).toHaveBeenCalledWith("Couldn't save the note: exists");
    expect(s.openNote).not.toHaveBeenCalled();
  });
});

describe("readNoteAttachment", () => {
  it("encodes the note's bytes as a text/markdown attachment", async () => {
    const bytes = new TextEncoder().encode("# Hi");
    const readBinary = vi.fn(async () => bytes.buffer as ArrayBuffer);
    const att = await readNoteAttachment(readBinary, { name: "Plan.md" });
    expect(att).toEqual({ filename: "Plan.md", mimeType: "text/markdown", contentBytes: Buffer.from("# Hi").toString("base64") });
    expect(readBinary).toHaveBeenCalledWith({ name: "Plan.md" });
  });

  it("propagates a read failure", async () => {
    await expect(readNoteAttachment(async () => { throw new Error("gone"); }, { name: "x.md" })).rejects.toThrow("gone");
  });
});
