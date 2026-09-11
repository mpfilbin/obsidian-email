import { describe, it, expect, beforeEach } from "vitest";
import {
  clampPaneWidths, loadPaneWidths, savePaneWidths, DEFAULT_PANE_WIDTHS,
} from "../../src/view/pane-layout";

const KEY = "obsidian-email:pane-widths";

describe("clampPaneWidths", () => {
  it("clamps below the minimum", () => {
    expect(clampPaneWidths({ mailboxes: 10, messageList: 10 })).toEqual({
      mailboxes: 140, messageList: 220,
    });
  });

  it("clamps above the maximum", () => {
    expect(clampPaneWidths({ mailboxes: 9999, messageList: 9999 })).toEqual({
      mailboxes: 400, messageList: 640,
    });
  });

  it("rounds fractional widths and passes through in-range values", () => {
    expect(clampPaneWidths({ mailboxes: 200.7, messageList: 340.2 })).toEqual({
      mailboxes: 201, messageList: 340,
    });
  });
});

describe("loadPaneWidths / savePaneWidths", () => {
  beforeEach(() => localStorage.clear());

  it("returns defaults when nothing is stored", () => {
    expect(loadPaneWidths()).toEqual(DEFAULT_PANE_WIDTHS);
  });

  it("round-trips a saved value", () => {
    savePaneWidths({ mailboxes: 250, messageList: 400 });
    expect(loadPaneWidths()).toEqual({ mailboxes: 250, messageList: 400 });
  });

  it("clamps a stored out-of-range value on load", () => {
    localStorage.setItem(KEY, JSON.stringify({ mailboxes: 5, messageList: 9999 }));
    expect(loadPaneWidths()).toEqual({ mailboxes: 140, messageList: 640 });
  });

  it("falls back to defaults for corrupt JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadPaneWidths()).toEqual(DEFAULT_PANE_WIDTHS);
  });

  it("fills in a partial stored value with defaults", () => {
    localStorage.setItem(KEY, JSON.stringify({ mailboxes: 250 }));
    expect(loadPaneWidths()).toEqual({ mailboxes: 250, messageList: DEFAULT_PANE_WIDTHS.messageList });
  });
});
