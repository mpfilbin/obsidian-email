import type { OutgoingAttachment } from "../providers/types";
import { arrayBufferToBase64 } from "../util/base64";
import { attachmentTargetPath, safeAttachmentName, uniqueAttachmentPath } from "../util/safe-filename";

export interface AdapterLike {
  exists(path: string): Promise<boolean>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
}

/** Hands a blob to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeAttachmentName(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface SaveBlobHost {
  /** The configured vault folder for attachments; empty/undefined = download. */
  getAttachmentDir: () => string | null | undefined;
  adapter: AdapterLike;
  normalizePath: (path: string) => string;
  notify: (message: string) => void;
  download?: (blob: Blob, filename: string) => void;
}

/**
 * Ruling D: persist attachments into the configured vault folder, else hand
 * the blob to the renderer as a download.
 *
 * `filename` is attacker-controlled (MIME Content-Disposition / Graph's
 * attachment `name`), so it is reduced to a single inert path segment before it
 * can reach `writeBinary`, the join is re-checked against the configured
 * folder, and an existing file is never overwritten.
 */
export function makeSaveBlob(host: SaveBlobHost): (blob: Blob, filename: string) => Promise<void> {
  return async (blob, filename) => {
    const dir = host.getAttachmentDir();
    if (!dir) {
      (host.download ?? downloadBlob)(blob, filename);
      return;
    }
    const rel = attachmentTargetPath(dir, filename, host.normalizePath);
    if (!rel) {
      host.notify(`Refused to save "${filename}" outside the attachment folder.`);
      return;
    }
    const target = await uniqueAttachmentPath(rel, (p) => host.adapter.exists(p));
    await host.adapter.writeBinary(target, await blob.arrayBuffer());
  };
}

export interface VaultLike {
  adapter: { exists(path: string): Promise<boolean> };
  createFolder(path: string): Promise<unknown>;
}

/** Walks each folder segment, creating any that don't yet exist, so
 *  `vault.create` never fails on a missing parent directory. */
export async function ensureFolder(vault: VaultLike, folderPath: string): Promise<void> {
  if (!folderPath || folderPath === "/") return;
  let cur = "";
  for (const seg of folderPath.split("/").filter(Boolean)) {
    cur = cur ? `${cur}/${seg}` : seg;
    if (!(await vault.adapter.exists(cur))) await vault.createFolder(cur);
  }
}

export interface SaveNoteHost {
  vault: VaultLike & { create(path: string, content: string): Promise<{ basename: string }> };
  /** Asks the user where to save; calls `onPath` with the confirmed path. */
  askPath: (defaultPath: string, onPath: (path: string) => Promise<void>) => void;
  openNote: (file: { basename: string }) => Promise<void>;
  notify: (message: string) => void;
}

/** Prompts for a vault path, creates the note (and any missing parent
 *  folders), and opens it. */
export function makeSaveNote(host: SaveNoteHost): (defaultPath: string, content: string) => void {
  return (defaultPath, content) => {
    host.askPath(defaultPath, async (path) => {
      try {
        await ensureFolder(host.vault, path.split("/").slice(0, -1).join("/"));
        const file = await host.vault.create(path, content);
        host.notify(`Saved "${file.basename}".`);
        await host.openNote(file);
      } catch (err) {
        host.notify(`Couldn't save the note: ${(err as Error).message}`);
      }
    });
  };
}

/** A vault note, base64-encoded, as an email attachment. */
export async function readNoteAttachment<F extends { name: string }>(
  readBinary: (file: F) => Promise<ArrayBuffer>,
  file: F,
): Promise<OutgoingAttachment> {
  return {
    filename: file.name,
    mimeType: "text/markdown",
    contentBytes: arrayBufferToBase64(await readBinary(file)),
  };
}
