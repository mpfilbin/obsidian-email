import { describe, it, expect } from "vitest";
import { adjacentThreadId, advanceTarget, keyToAction, shouldIgnoreTarget } from "../../src/view/shortcuts";

const key = (k: string, over: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean }> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...over });

describe("keyToAction", () => {
  it("maps each built-in key", () => {
    expect(keyToAction(key("j"))).toBe("next");
    expect(keyToAction(key("k"))).toBe("previous");
    expect(keyToAction(key("f"))).toBe("flag");
    expect(keyToAction(key("p"))).toBe("pin");
    expect(keyToAction(key("e"))).toBe("archive");
    expect(keyToAction(key("#"))).toBe("delete");
    expect(keyToAction(key("Delete"))).toBe("delete");
  });

  it("ignores other keys, capitals and modified keys", () => {
    for (const k of ["a", "J", "E", "Enter", "ArrowDown", " "]) expect(keyToAction(key(k)), k).toBeNull();
    for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) expect(keyToAction(key("e", { [mod]: true })), mod).toBeNull();
  });

  it("honours key repeat for navigation only", () => {
    expect(keyToAction(key("j", { repeat: true }))).toBe("next");
    expect(keyToAction(key("k", { repeat: true }))).toBe("previous");
    for (const k of ["f", "p", "e", "#", "Delete"]) expect(keyToAction(key(k, { repeat: true })), k).toBeNull();
  });
});

describe("shouldIgnoreTarget", () => {
  const el = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild!.querySelector("[data-t]") ?? d.firstElementChild!; };

  it("ignores text fields and contenteditable regions, including their children", () => {
    expect(shouldIgnoreTarget(el('<div><input data-t></div>'))).toBe(true);
    expect(shouldIgnoreTarget(el('<div><textarea data-t></textarea></div>'))).toBe(true);
    expect(shouldIgnoreTarget(el('<div><select data-t></select></div>'))).toBe(true);
    expect(shouldIgnoreTarget(el('<div contenteditable="true"><p data-t>x</p></div>'))).toBe(true);
    expect(shouldIgnoreTarget(el('<div contenteditable><p data-t>x</p></div>'))).toBe(true);
  });

  it("lets keys through from rows, buttons and non-editable regions", () => {
    expect(shouldIgnoreTarget(el('<div data-t></div>'))).toBe(false);
    expect(shouldIgnoreTarget(el('<div><button data-t></button></div>'))).toBe(false);
    expect(shouldIgnoreTarget(el('<div contenteditable="false"><p data-t>x</p></div>'))).toBe(false);
    expect(shouldIgnoreTarget(null)).toBe(false);
    expect(shouldIgnoreTarget(window)).toBe(false);
  });
});

describe("adjacentThreadId", () => {
  const rows = ["a", "b", "c", "d"].map((threadId) => ({ threadId }));

  it("steps forwards and backwards in list order", () => {
    expect(adjacentThreadId(rows, "b", 1)).toBe("c");
    expect(adjacentThreadId(rows, "b", -1)).toBe("a");
  });

  it("stops at the ends instead of wrapping", () => {
    expect(adjacentThreadId(rows, "d", 1)).toBeNull();
    expect(adjacentThreadId(rows, "a", -1)).toBeNull();
  });

  it("starts at the first row when nothing is open, and has no previous", () => {
    expect(adjacentThreadId(rows, null, 1)).toBe("a");
    expect(adjacentThreadId(rows, null, -1)).toBeNull();
  });

  it("treats an id that is no longer listed as nothing open", () => {
    expect(adjacentThreadId(rows, "gone", 1)).toBe("a");
    expect(adjacentThreadId(rows, "gone", -1)).toBeNull();
  });

  it("skips rows in the skip set, including the first one", () => {
    expect(adjacentThreadId(rows, "a", 1, new Set(["b"]))).toBe("c");
    expect(adjacentThreadId(rows, "d", -1, new Set(["c", "b"]))).toBe("a");
    expect(adjacentThreadId(rows, null, 1, new Set(["a"]))).toBe("b");
    expect(adjacentThreadId(rows, "b", 1, new Set(["c", "d"]))).toBeNull();
  });

  it("handles an empty list", () => {
    expect(adjacentThreadId([], null, 1)).toBeNull();
    expect(adjacentThreadId([], "a", 1)).toBeNull();
  });
});

describe("advanceTarget", () => {
  const rows = ["a", "b", "c"].map((threadId) => ({ threadId }));

  it("prefers the next row", () => expect(advanceTarget(rows, "b")).toBe("c"));
  it("falls back to the previous row at the end", () => expect(advanceTarget(rows, "c")).toBe("b"));
  it("skips pending rows in both directions", () => {
    expect(advanceTarget(rows, "a", new Set(["b"]))).toBe("c");
    expect(advanceTarget(rows, "c", new Set(["b"]))).toBe("a");
  });
  it("is null for the only row, when every other row is pending, or when the open row isn't listed", () => {
    expect(advanceTarget([{ threadId: "a" }], "a")).toBeNull();
    expect(advanceTarget(rows, "b", new Set(["a", "c"]))).toBeNull();
    expect(advanceTarget(rows, "zzz")).toBeNull();
  });
});
