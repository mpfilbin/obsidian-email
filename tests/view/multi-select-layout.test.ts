import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Layout regression guards (jsdom can't lay anything out). Both bugs these
// protect against were Obsidian's own theme CSS beating the plugin's:
//  - its `input[type='checkbox'] { position: relative }` outranks a one-class
//    selector, which dropped the row checkbox into the flow over the sender;
//  - a `background:` / `padding:` shorthand on its `.dropdown` select wipes the
//    chevron (a background image with its own size/position) and its padding.
const css = readFileSync("styles.css", "utf8");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
/** The declarations of every rule with exactly this selector, joined. */
const rule = (selector: string): string | undefined => {
  const bodies = [...css.matchAll(new RegExp(`(?:^|\\})\\s*${esc(selector)}\\s*\\{([^}]*)\\}`, "gm"))].map((m) => m[1]);
  return bodies.length ? bodies.join("\n") : undefined;
};

describe("row checkbox", () => {
  it("is pinned out of the flow with a selector that outranks Obsidian's checkbox rule", () => {
    const r = rule(".oe-thread-row > .oe-row-check");
    expect(r).toMatch(/position:\s*absolute/);
    expect(r).toMatch(/opacity:\s*0/);
  });

  it("has no single-class rule that Obsidian's theme could override", () => {
    expect(rule(".oe-row-check")).toBeUndefined();
  });

  it("is revealed on hover, focus, an active selection, or when ticked", () => {
    for (const sel of [
      ".oe-thread-row:hover > .oe-row-check",
      ".oe-thread-row:focus-within > .oe-row-check",
      ".oe-thread-row.selection-active > .oe-row-check",
      ".oe-thread-row > .oe-row-check:checked",
    ]) expect(css, sel).toContain(sel);
  });

  it("leaves room for it in the row", () => {
    expect(rule(".oe-thread-row")).toMatch(/padding-left:\s*30px/);
  });
});

describe("bulk bar Move menu", () => {
  it("only adjusts size, so Obsidian's dropdown chevron and padding survive", () => {
    const r = rule(".oe-bulk-bar select.dropdown") ?? "";
    expect(r).toMatch(/font-size/);
    expect(r).not.toMatch(/(^|[;\s])background\s*:/);
    expect(r).not.toMatch(/(^|[;\s])padding\s*:/);
    expect(r).not.toMatch(/(^|[;\s])border\s*:/);
  });

  it("isn't swept up by the bar's button rules", () => {
    expect(css).not.toMatch(/\.oe-bulk-bar select\s*[,{]/);
  });
});
