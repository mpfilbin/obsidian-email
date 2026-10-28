import { describe, it, expect, vi } from "vitest";
import { buildPaletteCommands, printTargetMessageId } from "../../src/host/palette";

const open = (...ids: string[]) => ids.map((id) => ({ summary: { id } }));
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("printTargetMessageId", () => {
  it("targets the newest message of the open thread", () => {
    expect(printTargetMessageId({ composer: null, openMessages: open("m1", "m2") } as never)).toBe("m2");
  });
  it("targets nothing when no thread is open", () => {
    expect(printTargetMessageId({ composer: null, openMessages: [] })).toBeUndefined();
  });
  it("targets nothing while a top-level composer (new / edit draft) replaces the thread", () => {
    for (const mode of ["new", "editDraft"]) {
      expect(printTargetMessageId({ composer: { mode }, openMessages: open("m1") } as never)).toBeUndefined();
    }
  });
  it("still targets the thread while replying inline", () => {
    for (const mode of ["reply", "replyAll", "forward"]) {
      expect(printTargetMessageId({ composer: { mode }, openMessages: open("m1") } as never)).toBe("m1");
    }
  });
});

function setup(state: Record<string, unknown> = { composer: null, openMessages: open("m1") }, unsaved = false, mail: { canPerform: (a: string) => boolean; perform: (a: string) => void } | null = null) {
  const vm = {
    getState: vi.fn(() => state),
    hasUnsavedComposerContent: vi.fn(() => unsaved),
    setMode: vi.fn(),
    printMessage: vi.fn(async () => {}),
    viewMessageHeaders: vi.fn(async () => {}),
  };
  const host = {
    activateView: vi.fn(async () => {}),
    noteCommands: { composeFromNote: vi.fn(), composeWithNoteAttached: vi.fn() },
    notify: vi.fn(),
    mail: vi.fn(() => mail),
    vm,
  };
  const commands = buildPaletteCommands(host as never);
  return { host, vm, cmd: (id: string) => commands.find((c) => c.id === id)!, commands };
}

describe("buildPaletteCommands", () => {
  it("registers the palette commands", () => {
    expect(setup().commands.map((c) => [c.id, c.name])).toEqual([
      ["open", "Open mail"],
      ["compose-from-note", "Create email from note"],
      ["compose-with-note-attached", "Create email with note attached"],
      ["open-contacts", "Open contacts"],
      ["print-message", "Print email"],
      ["view-message-headers", "View email headers"],
      ["next-email", "Next email"],
      ["previous-email", "Previous email"],
      ["toggle-flag", "Flag or unflag email"],
      ["toggle-pin", "Pin or unpin email"],
      ["archive-email", "Archive email"],
      ["delete-email", "Delete email"],
    ]);
  });

  it("'Open mail' reveals the view; the compose commands delegate to the note commands", () => {
    const { cmd, host } = setup();
    cmd("open").callback!();
    expect(host.activateView).toHaveBeenCalledOnce();
    expect(cmd("compose-from-note").callback).toBe(host.noteCommands.composeFromNote);
    expect(cmd("compose-with-note-attached").callback).toBe(host.noteCommands.composeWithNoteAttached);
  });

  describe("open-contacts", () => {
    it("reveals the view and switches to Contacts", async () => {
      const { cmd, host, vm } = setup();
      cmd("open-contacts").callback!();
      await settle();
      expect(host.activateView).toHaveBeenCalledOnce();
      expect(vm.setMode).toHaveBeenCalledWith("contacts");
    });

    it("refuses while an unsent message would be lost", async () => {
      const { cmd, host, vm } = setup(undefined, true);
      cmd("open-contacts").callback!();
      await settle();
      expect(host.notify).toHaveBeenCalledWith("Finish or discard your unsent message before opening contacts.");
      expect(host.activateView).not.toHaveBeenCalled();
      expect(vm.setMode).not.toHaveBeenCalled();
    });

    it("reports a failure to open the view", async () => {
      const { cmd, host, vm } = setup();
      host.activateView.mockRejectedValue(new Error("no leaf"));
      cmd("open-contacts").callback!();
      await settle();
      expect(host.notify).toHaveBeenCalledWith("Couldn't open contacts: no leaf");
      expect(vm.setMode).not.toHaveBeenCalled();
    });
  });

  describe("print-message", () => {
    it("is available (checking) only when there's a message to print", () => {
      expect(setup().cmd("print-message").checkCallback!(true)).toBe(true);
      expect(setup({ composer: null, openMessages: [] }).cmd("print-message").checkCallback!(true)).toBe(false);
      expect(setup({ composer: { mode: "new" }, openMessages: open("m1") }).cmd("print-message").checkCallback!(true)).toBe(false);
    });

    it("prints the newest message when run, and does nothing while checking", () => {
      const { cmd, vm } = setup({ composer: null, openMessages: open("m1", "m2") });
      cmd("print-message").checkCallback!(true);
      expect(vm.printMessage).not.toHaveBeenCalled();
      expect(cmd("print-message").checkCallback!(false)).toBe(true);
      expect(vm.printMessage).toHaveBeenCalledWith("m2");
    });

    it("runs as a no-op when nothing is printable", () => {
      const { cmd, vm } = setup({ composer: null, openMessages: [] });
      cmd("print-message").checkCallback!(false);
      expect(vm.printMessage).not.toHaveBeenCalled();
    });
  });

  describe("view-message-headers", () => {
    it("is available (checking) only when there's a message open", () => {
      expect(setup().cmd("view-message-headers").checkCallback!(true)).toBe(true);
      expect(setup({ composer: null, openMessages: [] }).cmd("view-message-headers").checkCallback!(true)).toBe(false);
    });

    it("views the newest message's headers when run, and does nothing while checking", () => {
      const { cmd, vm } = setup({ composer: null, openMessages: open("m1", "m2") });
      cmd("view-message-headers").checkCallback!(true);
      expect(vm.viewMessageHeaders).not.toHaveBeenCalled();
      expect(cmd("view-message-headers").checkCallback!(false)).toBe(true);
      expect(vm.viewMessageHeaders).toHaveBeenCalledWith("m2");
    });
  });

  describe("keyboard commands", () => {
    const COMMANDS = [
      ["next-email", "next"], ["previous-email", "previous"], ["toggle-flag", "flag"],
      ["toggle-pin", "pin"], ["archive-email", "archive"], ["delete-email", "delete"],
    ] as const;
    const mailKeys = (allowed: (a: string) => boolean = () => true) => ({ canPerform: vi.fn(allowed), perform: vi.fn() });

    it("are unavailable, and do nothing, unless the mail view is the active view", () => {
      const { cmd } = setup(undefined, false, null);
      for (const [id] of COMMANDS) {
        expect(cmd(id).checkCallback!(true), id).toBe(false);
        expect(cmd(id).checkCallback!(false), id).toBe(false);
      }
    });

    it("are available when the view says the action is possible, without running it while only checking", () => {
      const mail = mailKeys();
      const { cmd } = setup(undefined, false, mail);
      for (const [id, action] of COMMANDS) {
        expect(cmd(id).checkCallback!(true), id).toBe(true);
        expect(mail.canPerform).toHaveBeenLastCalledWith(action);
      }
      expect(mail.perform).not.toHaveBeenCalled();
    });

    it("are unavailable when the view says the action is not possible", () => {
      const mail = mailKeys((a) => a !== "archive");
      const { cmd } = setup(undefined, false, mail);
      expect(cmd("archive-email").checkCallback!(true)).toBe(false);
      expect(cmd("archive-email").checkCallback!(false)).toBe(false);
      expect(mail.perform).not.toHaveBeenCalled();
      expect(cmd("delete-email").checkCallback!(true)).toBe(true);
    });

    it("run the matching action through the view's dispatcher", () => {
      const mail = mailKeys();
      const { cmd } = setup(undefined, false, mail);
      for (const [id, action] of COMMANDS) {
        expect(cmd(id).checkCallback!(false), id).toBe(true);
        expect(mail.perform).toHaveBeenLastCalledWith(action);
      }
      expect(mail.perform).toHaveBeenCalledTimes(COMMANDS.length);
    });
  });
});
