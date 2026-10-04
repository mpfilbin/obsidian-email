import type { NoteCommands } from "../view/mail-view";
import type { OutgoingAttachment } from "../providers/types";
import { readNoteAttachment } from "./vault-io";

export interface NoteFile {
  name: string;
  basename: string;
  extension: string;
}

export interface NoteHost<F extends NoteFile = NoteFile> {
  activeFile: () => F | null;
  /** Fuzzy-search picker over the vault's notes. */
  pickNote: (onResolve: (file: F) => void, onCancel?: () => void) => void;
  readBinary: (file: F) => Promise<ArrayBuffer>;
  renderToHtml: (file: F) => Promise<string>;
  activateView: () => Promise<void>;
  notify: (message: string) => void;
  openComposeFromNote: (subject: string, bodyHtml: string) => void;
  openComposeWithAttachment: (attachment: OutgoingAttachment) => void;
}

/** "Any note from my vault": the active note if one's a Markdown file, else a
 *  picker over every note in the vault. */
export function makeResolveNote<F extends NoteFile>(host: NoteHost<F>) {
  return (onResolve: (file: F) => void, onCancel?: () => void): void => {
    const active = host.activeFile();
    if (active?.extension === "md") {
      onResolve(active);
      return;
    }
    host.pickNote(onResolve, onCancel);
  };
}

/** Resolves to the chosen note as an attachment, or undefined if the user
 *  cancelled or the read failed (the failure is reported). */
export function makePickNoteAttachment<F extends NoteFile>(host: NoteHost<F>): () => Promise<OutgoingAttachment | undefined> {
  const resolveNote = makeResolveNote(host);
  return () =>
    new Promise((resolve) => {
      resolveNote(
        (file) => {
          void (async () => {
            try {
              resolve(await readNoteAttachment(host.readBinary, file));
            } catch (err) {
              host.notify(`Couldn't attach "${file.name}": ${(err as Error).message}`);
              resolve(undefined);
            }
          })();
        },
        () => resolve(undefined),
      );
    });
}

export function makeNoteCommands<F extends NoteFile>(host: NoteHost<F>): NoteCommands {
  const resolveNote = makeResolveNote(host);
  return {
    composeFromNote: () => {
      resolveNote((file) => {
        void (async () => {
          try {
            const bodyHtml = await host.renderToHtml(file);
            await host.activateView();
            host.openComposeFromNote(file.basename, bodyHtml);
          } catch (err) {
            host.notify(`Couldn't create an email from "${file.basename}": ${(err as Error).message}`);
          }
        })();
      });
    },
    composeWithNoteAttached: () => {
      resolveNote((file) => {
        void (async () => {
          try {
            const attachment = await readNoteAttachment(host.readBinary, file);
            await host.activateView();
            host.openComposeWithAttachment(attachment);
          } catch (err) {
            host.notify(`Couldn't attach "${file.name}": ${(err as Error).message}`);
          }
        })();
      });
    },
  };
}
