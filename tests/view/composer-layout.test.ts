import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Layout regression guard (jsdom can't lay anything out): a new-message /
// edit-draft composer owns the whole reading pane, so its editor must grow to
// fill it rather than stopping at the inline composer's 260px cap.
const css = readFileSync("styles.css", "utf8");
const rule = (selector: string): string | undefined =>
  new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m").exec(css)?.[1];

describe("composer layout", () => {
  it("keeps the inline composer's editor capped", () => {
    expect(rule(".oe-composer .ql-editor")).toMatch(/max-height:\s*260px/);
  });

  it("lets a top-level composer fill the reading pane", () => {
    expect(rule(".oe-reading-pane > .oe-composer")).toMatch(/flex:\s*1 1 auto/);
    expect(rule(".oe-reading-pane > .oe-composer")).toMatch(/min-height:\s*0/);
  });

  it("removes the editor's height cap, and lets it grow, only for the top-level composer", () => {
    const editor = rule(".oe-reading-pane > .oe-composer .ql-editor");
    expect(editor).toMatch(/max-height:\s*none/);
    expect(editor).toMatch(/flex:\s*1 1 auto/);
  });
});
