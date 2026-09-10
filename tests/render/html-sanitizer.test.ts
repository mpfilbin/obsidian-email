import { describe, it, expect } from "vitest";
import { sanitizeEmailHtml, restoreBlockedContent } from "../../src/render/html-sanitizer";

const clean = (raw: string, allowRemote = false) => sanitizeEmailHtml(raw, { allowRemote });

describe("sanitizeEmailHtml — security", () => {
  it("strips script tags", () => {
    expect(clean('<p>hi</p><script>alert(1)</script>').html).toBe("<p>hi</p>");
  });
  it("strips inline event handlers", () => {
    expect(clean('<img src="x" onerror="alert(1)">').html).not.toContain("onerror");
  });
  it("strips javascript: hrefs", () => {
    const r = clean('<a href="javascript:alert(1)">x</a>');
    expect(r.html).not.toContain("javascript:");
  });
  it("drops iframes, objects, forms", () => {
    const r = clean('<iframe src="https://e.com"></iframe><object></object><form></form>');
    expect(r.html).not.toMatch(/iframe|object|form/);
  });
  it("keeps benign formatting and tables", () => {
    const r = clean("<h1>T</h1><table><tr><td><b>x</b></td></tr></table>");
    expect(r.html).toContain("<table>");
    expect(r.html).toContain("<b>x</b>");
  });
});

describe("sanitizeEmailHtml — remote content", () => {
  it("blocks remote images by default and flags it", () => {
    const r = clean('<img src="https://tracker.example/pixel.gif">');
    expect(r.blockedRemoteContent).toBe(true);
    expect(r.html).not.toContain('src="https://tracker');
    expect(r.html).toContain("data-blocked-src");
  });
  it("allows inline data: images", () => {
    const r = clean('<img src="data:image/png;base64,AAAA">');
    expect(r.blockedRemoteContent).toBe(false);
    expect(r.html).toContain("data:image/png");
  });
  it("keeps remote images when allowRemote is true", () => {
    const r = clean('<img src="https://cdn.example/logo.png">', true);
    expect(r.blockedRemoteContent).toBe(false);
    expect(r.html).toContain("https://cdn.example/logo.png");
  });
  it("neutralizes remote url() in style attributes", () => {
    const r = clean('<div style="background-image:url(https://x.example/bg.png)">x</div>');
    expect(r.html).not.toContain("x.example");
  });
});

describe("sanitizeEmailHtml — links", () => {
  it("forces target and rel and mirrors href into title", () => {
    const r = clean('<a href="https://example.com/path">click</a>');
    expect(r.html).toContain('target="_blank"');
    expect(r.html).toContain('rel="noopener noreferrer"');
    expect(r.html).toContain('title="https://example.com/path"');
  });
});

describe("restoreBlockedContent", () => {
  it("swaps data-blocked-src back to src", () => {
    const div = document.createElement("div");
    div.innerHTML = '<img data-blocked-src="https://cdn.example/a.png">';
    restoreBlockedContent(div);
    expect(div.querySelector("img")!.getAttribute("src")).toBe("https://cdn.example/a.png");
    expect(div.querySelector("img")!.hasAttribute("data-blocked-src")).toBe(false);
  });
});
