import { describe, it, expect } from "vitest";
import Quill from "quill";

describe("Quill under vitest+jsdom", () => {
  it("initializes, accepts text, and supports a real toolbar-button click on a selection", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const q = new Quill(el, { theme: "snow", modules: { toolbar: ["bold"] } });

    q.setText("hello");
    expect(q.root.innerHTML).toBe("<p>hello</p>");

    q.setSelection(0, 5);
    const boldBtn = el.parentElement!.querySelector<HTMLButtonElement>("button.ql-bold")!;
    boldBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(q.root.innerHTML).toBe("<p><strong>hello</strong></p>");
  });

  it("an empty editor's text is a single newline, not an empty string", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const q = new Quill(el, { theme: "snow" });
    expect(q.getText()).toBe("\n");
    expect(q.root.innerHTML).toBe("<p><br></p>");
  });
});
