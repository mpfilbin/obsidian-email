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
  it("keeps remote url() in style attributes when allowRemote is true", () => {
    const r = clean('<div style="background-image:url(https://x.example/bg.png)">x</div>', true);
    expect(r.html).toContain("x.example");
  });
});

describe("sanitizeEmailHtml — CSS-comment scan gap (Rec3 residual)", () => {
  it("flags a style url() hidden behind a CSS comment", () => {
    const r = clean('<div style=\'background:url(/*c*/"https://tracker.example/x.png")\'>x</div>');
    expect(r.blockedRemoteContent).toBe(true);
  });
  it("does not flag a benign style value with no //", () => {
    const r = clean('<div style="color:red;font-size:14px">x</div>');
    expect(r.blockedRemoteContent).toBe(false);
  });
});

describe("sanitizeEmailHtml — remote content beyond <img src>", () => {
  it("blocks remote href on SVG <image> and restores it", () => {
    const r = clean('<svg><image href="https://tracker.example/p.png"></image></svg>');
    expect(r.blockedRemoteContent).toBe(true);
    expect(r.html).not.toContain('href="https://tracker');
    expect(r.html).toContain("data-blocked-href");

    const div = document.createElement("div");
    div.innerHTML = r.html;
    restoreBlockedContent(div);
    const image = div.querySelector("image")!;
    expect(image.getAttribute("href")).toBe("https://tracker.example/p.png");
    expect(image.hasAttribute("data-blocked-href")).toBe(false);
  });

  it("blocks remote poster on <video> and restores it", () => {
    const r = clean('<video poster="https://tracker.example/poster.jpg"></video>');
    expect(r.blockedRemoteContent).toBe(true);
    expect(r.html).not.toContain('poster="https://tracker');
    expect(r.html).toContain("data-blocked-poster");

    const div = document.createElement("div");
    div.innerHTML = r.html;
    restoreBlockedContent(div);
    const video = div.querySelector("video")!;
    expect(video.getAttribute("poster")).toBe("https://tracker.example/poster.jpg");
    expect(video.hasAttribute("data-blocked-poster")).toBe(false);
  });

  it("blocks remote src on <input type=image> and restores it", () => {
    const r = clean('<input type="image" src="https://tracker.example/pixel.png">');
    expect(r.blockedRemoteContent).toBe(true);
    expect(r.html).not.toContain('src="https://tracker');
    expect(r.html).toContain("data-blocked-src");

    const div = document.createElement("div");
    div.innerHTML = r.html;
    restoreBlockedContent(div);
    const input = div.querySelector("input")!;
    expect(input.getAttribute("src")).toBe("https://tracker.example/pixel.png");
    expect(input.hasAttribute("data-blocked-src")).toBe(false);
  });

  it("blocks protocol-relative remote images and restores them", () => {
    const r = clean('<img src="//tracker.example/x.png">');
    expect(r.blockedRemoteContent).toBe(true);
    expect(r.html).not.toContain('src="//tracker');
    expect(r.html).toContain("data-blocked-src");

    const div = document.createElement("div");
    div.innerHTML = r.html;
    restoreBlockedContent(div);
    expect(div.querySelector("img")!.getAttribute("src")).toBe("//tracker.example/x.png");
  });

  it("does not treat a bare path as remote", () => {
    const r = clean('<img src="/local/path.png">');
    expect(r.blockedRemoteContent).toBe(false);
    expect(r.html).toContain('src="/local/path.png"');
  });
});

describe("sanitizeEmailHtml — remote-content negative control", () => {
  // Every vector here must both (a) flip blockedRemoteContent so the user sees
  // the "Load remote images" banner, and (b) leave no live tracker URL behind.
  const VECTORS: Array<[string, string]> = [
    ["img src", '<img src="https://tracker.example/x.png">'],
    ["img protocol-relative src", '<img src="//tracker.example/x.png">'],
    ["svg image href", '<svg><image href="https://tracker.example/x.png"></image></svg>'],
    ["svg image xlink:href", '<svg><image xlink:href="https://tracker.example/x.png"></image></svg>'],
    ["svg use xlink:href", '<svg><use xlink:href="https://tracker.example/x.svg#i"></use></svg>'],
    ["video poster", '<video poster="https://tracker.example/x.jpg"></video>'],
    ["video src", '<video src="https://tracker.example/x.mp4"></video>'],
    ["audio src", '<audio src="https://tracker.example/x.mp3"></audio>'],
    ["input type=image src", '<input type="image" src="https://tracker.example/x.png">'],
    ["style block url()", "<style>p{background:url(https://tracker.example/x.png)}</style>"],
    ["style block @import", "<style>@import url(https://tracker.example/x.css);</style>"],
    ["style attr image-set()", `<div style="background:image-set('https://tracker.example/x.png' 1x)">x</div>`],
    ["style attr -webkit-image-set()", `<div style="background:-webkit-image-set('https://tracker.example/x.png' 1x)">x</div>`],
    ["style attr url()", '<div style="background-image:url(https://tracker.example/x.png)">x</div>'],
  ];

  for (const [label, raw] of VECTORS) {
    it(`flags and neutralizes: ${label}`, () => {
      const r = clean(raw);
      expect(r.blockedRemoteContent, `${label} should set blockedRemoteContent`).toBe(true);
      expect(r.html, `${label} leaked a live tracker URL`).not.toContain("https://tracker");
      expect(r.html, `${label} leaked a protocol-relative tracker URL`).not.toContain("//tracker");
    });
  }
});

describe("sanitizeEmailHtml — <style> elements", () => {
  it("drops style elements and their CSS entirely", () => {
    const r = clean("<style>body{display:none}</style><p>hi</p>");
    expect(r.html).not.toContain("display:none");
    expect(r.html).not.toContain("<style");
    expect(r.html).toContain("<p>hi</p>");
  });
});

describe("sanitizeEmailHtml — forged data-blocked-* markers", () => {
  it("does not launder an attacker-supplied data-blocked-href into a javascript: href", () => {
    const r = clean('<a data-blocked-href="javascript%3Aalert(1)">x</a>');
    const div = document.createElement("div");
    div.innerHTML = r.html;
    restoreBlockedContent(div);
    const a = div.querySelector("a")!;
    expect(a.getAttribute("href")).toBeNull();
    expect(div.innerHTML).not.toContain("javascript:");
  });

  it("drops forged markers on every stashable attribute", () => {
    const r = clean(
      '<img data-blocked-src="javascript%3Aalert(1)">' +
        '<video data-blocked-poster="javascript%3Aalert(2)"></video>' +
        '<svg><image data-blocked-xlink-href="javascript%3Aalert(3)"></image></svg>',
    );
    expect(r.html).not.toContain("data-blocked-");
  });

  it("still blocks a real remote src when a forged marker rides along", () => {
    const r = clean('<img data-blocked-src="javascript%3Aalert(1)" src="https://tracker.example/x.png">');
    expect(r.blockedRemoteContent).toBe(true);
    const div = document.createElement("div");
    div.innerHTML = r.html;
    restoreBlockedContent(div);
    expect(div.querySelector("img")!.getAttribute("src")).toBe("https://tracker.example/x.png");
  });
});

describe("sanitizeEmailHtml — links", () => {
  it("forces target and rel and mirrors href into title", () => {
    const r = clean('<a href="https://example.com/path">click</a>');
    expect(r.html).toContain('target="_blank"');
    expect(r.html).toContain('rel="noopener noreferrer"');
    expect(r.html).toContain('title="https://example.com/path"');
  });
  it("does not treat a plain remote link as blocked remote content", () => {
    expect(clean('<a href="https://example.com/path">click</a>').blockedRemoteContent).toBe(false);
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

  it("restores a blocked xlink:href round-trip", () => {
    const r = clean('<svg><image xlink:href="https://tracker.example/p.png"></image></svg>');
    const div = document.createElement("div");
    div.innerHTML = r.html;
    restoreBlockedContent(div);
    const image = div.querySelector("image")!;
    expect(image.getAttribute("xlink:href")).toBe("https://tracker.example/p.png");
    expect(image.hasAttribute("data-blocked-xlink-href")).toBe(false);
  });

  it("refuses to promote a non-http(s) stashed value", () => {
    const div = document.createElement("div");
    div.innerHTML = '<img data-blocked-src="javascript%3Aalert(1)">';
    restoreBlockedContent(div);
    const img = div.querySelector("img")!;
    expect(img.getAttribute("src")).toBeNull();
    expect(img.hasAttribute("data-blocked-src")).toBe(false);
  });
});
