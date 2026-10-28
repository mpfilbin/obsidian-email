import type { NoteCommands } from "../view/mail-view";
import type { ViewState } from "../view/view-model";
import type { KeyAction } from "../view/shortcuts";

export interface PaletteCommand {
  id: string;
  name: string;
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean | void;
}

/** The message "Print email" targets from the palette: the newest in the open
 *  thread, unless a top-level composer has replaced the thread view.
 *
 *  Mirrors the ribbon's `hasTargetMessage`: a message is on screen only when no
 *  top-level composer is open. The palette has no visibility into which message
 *  is manually expanded, though, so (unlike the ribbon) this always targets the
 *  thread's newest message. */
export function printTargetMessageId(state: Pick<ViewState, "composer" | "openMessages">): string | undefined {
  const composerOpen = state.composer?.mode === "new" || state.composer?.mode === "editDraft";
  const messages = state.openMessages;
  return !composerOpen && messages.length > 0 ? messages[messages.length - 1].summary.id : undefined;
}

/** The mail view's keyboard dispatcher — the same one the built-in keys use, so
 *  the unsaved-composer prompt and the delete confirmation apply to commands too. */
export interface MailKeys {
  canPerform(action: KeyAction): boolean;
  perform(action: KeyAction): void;
}

export interface PaletteHost {
  /** The mail view, but only while it is the active view — so a hotkey such as
   *  Ctrl+E can't archive mail while the user is typing in a note. */
  mail: () => MailKeys | null;
  activateView: () => Promise<void>;
  noteCommands: NoteCommands;
  notify: (message: string) => void;
  vm: {
    getState(): Pick<ViewState, "composer" | "openMessages">;
    hasUnsavedComposerContent(): boolean;
    setMode(mode: "mail" | "contacts"): void;
    printMessage(messageId: string): Promise<void>;
    viewMessageHeaders(messageId: string): Promise<void>;
  };
}

export function buildPaletteCommands(host: PaletteHost): PaletteCommand[] {
  const { vm, noteCommands } = host;
  const keyCommand = (id: string, name: string, action: KeyAction): PaletteCommand => ({
    id,
    name,
    checkCallback: (checking) => {
      const mail = host.mail();
      if (!mail || !mail.canPerform(action)) return false;
      if (!checking) mail.perform(action);
      return true;
    },
  });
  return [
    { id: "open", name: "Open mail", callback: () => void host.activateView() },
    { id: "compose-from-note", name: "Create email from note", callback: noteCommands.composeFromNote },
    { id: "compose-with-note-attached", name: "Create email with note attached", callback: noteCommands.composeWithNoteAttached },
    {
      id: "open-contacts",
      name: "Open contacts",
      callback: () => {
        void (async () => {
          // The palette bypasses App's unsaved-content prompt, and entering
          // Contacts drops the composer — so refuse rather than lose a draft.
          if (vm.hasUnsavedComposerContent()) {
            host.notify("Finish or discard your unsent message before opening contacts.");
            return;
          }
          try {
            await host.activateView();
            vm.setMode("contacts");
          } catch (err) {
            host.notify(`Couldn't open contacts: ${(err as Error).message}`);
          }
        })();
      },
    },
    {
      id: "print-message",
      name: "Print email",
      checkCallback: (checking) => {
        const target = printTargetMessageId(vm.getState());
        if (checking) return target !== undefined;
        if (target !== undefined) void vm.printMessage(target);
        return true;
      },
    },
    {
      id: "view-message-headers",
      name: "View email headers",
      checkCallback: (checking) => {
        const target = printTargetMessageId(vm.getState());
        if (checking) return target !== undefined;
        if (target !== undefined) void vm.viewMessageHeaders(target);
        return true;
      },
    },
    keyCommand("next-email", "Next email", "next"),
    keyCommand("previous-email", "Previous email", "previous"),
    keyCommand("toggle-select", "Select or deselect email", "select"),
    keyCommand("toggle-read", "Mark email read or unread", "read"),
    keyCommand("toggle-flag", "Flag or unflag email", "flag"),
    keyCommand("toggle-pin", "Pin or unpin email", "pin"),
    keyCommand("archive-email", "Archive email", "archive"),
    keyCommand("delete-email", "Delete email", "delete"),
  ];
}
