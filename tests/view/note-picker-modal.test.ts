import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotePickerModal } from "../../src/view/note-picker-modal";
import type { TFile } from "obsidian";

const file = { path: "Notes/a.md", name: "a.md" } as TFile;
const app = { vault: { getMarkdownFiles: () => [file] } } as never;

describe("NotePickerModal", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("lists markdown notes by path", () => {
    const modal = new NotePickerModal(app, vi.fn());
    expect(modal.getItems()).toEqual([file]);
    expect(modal.getItemText(file)).toBe("Notes/a.md");
  });

  it("calls onCancel when dismissed without choosing a note", () => {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    const modal = new NotePickerModal(app, onChoose, onCancel);
    modal.close();
    expect(onCancel).not.toHaveBeenCalled(); // decided one tick later
    vi.advanceTimersByTime(0);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("does not cancel when a note is chosen before the modal reports closing", () => {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    const modal = new NotePickerModal(app, onChoose, onCancel);
    modal.onChooseItem(file);
    modal.close();
    vi.advanceTimersByTime(0);
    expect(onChoose).toHaveBeenCalledWith(file);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("does not cancel when the modal reports closing before the chosen note", () => {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    const modal = new NotePickerModal(app, onChoose, onCancel);
    modal.close();
    modal.onChooseItem(file);
    vi.advanceTimersByTime(0);
    expect(onChoose).toHaveBeenCalledWith(file);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("tolerates being dismissed with no onCancel handler", () => {
    const modal = new NotePickerModal(app, vi.fn());
    modal.close();
    expect(() => vi.advanceTimersByTime(0)).not.toThrow();
  });
});
