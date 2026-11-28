// Regression suite for the HTML sanitizer, driven by a corpus of hostile input.
// See docs/security/threat-model.md: V-1 (nothing attacker-influenced reaches a
// DOM sink except via sanitizeEmailHtml), V-3 (remote content), and R-16
// (encode the security invariants as tests).
//
// The checks parse the sanitized HTML into a real DOM, the way
// message-renderer.ts does with `container.innerHTML = html`, and inspect
// elements and attributes. That avoids false positives from escaped text
// (`&lt;img onerror=…&gt;` is inert) and catches mutation XSS, where the
// output only becomes dangerous after the browser reparses it.
//
// Run it again, and read any diff, whenever `dompurify` or `jsdom` is upgraded.
import { describe, it, expect } from "vitest";
import { sanitizeEmailHtml, restoreBlockedContent } from "../../src/render/html-sanitizer";
import { CORPUS_ENTRIES, HOSTILE_CORPUS, KNOWN_GAP_ENTRIES } from "./fixtures/hostile-html-corpus";

const MODES = [
  { label: "remote blocked", allowRemote: false },
  { label: "remote allowed", allowRemote: true },
] as const;

function mount(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

// Strip ASCII whitespace and control characters, which URL parsers ignore, so
// `java\tscript:` and `ht\ttp://` are judged as the browser would read them.
const normalize = (value: string) => value.replace(/[\u0000- \u007f-\u009f]/g, "").toLowerCase();

const EXECUTABLE_OR_EMBEDDING_TAGS = new Set([
  "script", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "style", "base", "meta", "link",
]);
const URL_ATTRS = ["href", "src", "xlink:href", "action", "formaction", "data", "poster", "background", "ping"];
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|bmp)[;,]/;
// DOMPurify lets a `data:` URI through on image elements whatever ALLOWED_URI_REGEXP says. An SVG loaded that way
// renders in image mode, where scripts and external loads are disabled, so it is inert on <img> and <image> only.
const SVG_DATA_IMAGE = /^data:image\/svg\+xml[;,]/;

/** Anything in the DOM that can run script or load an embedding context. */
function liveHazards(root: HTMLElement): string[] {
  const found: string[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    if (EXECUTABLE_OR_EMBEDDING_TAGS.has(tag)) found.push(`<${tag}>`);
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) found.push(`<${tag} ${name}>`);
      if (name === "srcdoc") found.push(`<${tag} srcdoc>`);
      if (name === "style" && /expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(attr.value)) {
        found.push(`<${tag} style=${attr.value}>`);
      }
      if (URL_ATTRS.includes(name)) {
        const v = normalize(attr.value);
        const inertSvgImage = (tag === "img" || tag === "image") && SVG_DATA_IMAGE.test(v);
        if (/^(?:javascript|vbscript):/.test(v) || (v.startsWith("data:") && !SAFE_DATA_IMAGE.test(v) && !inertSvgImage)) {
          found.push(`<${tag} ${name}=${attr.value}>`);
        }
      }
    }
  }
  return found;
}

const REMOTE_URL = /^(?:https?:)?\/\//;
const REMOTE_CSS = /(?:url|image-set)\(\s*['"]?\s*(?:https?:)?\/\//i;

/** Attributes that make the browser fetch (or may fetch) a remote resource. */
function remoteReferences(root: HTMLElement): string[] {
  const found: string[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const v = normalize(attr.value);
      const fetches =
        ["src", "srcset", "poster", "background", "data", "formaction"].includes(name) ||
        // A link's href is navigation, not a fetch. Everything else with an href (SVG image/use/feImage) fetches.
        ((name === "href" || name === "xlink:href") && tag !== "a");
      if (fetches && REMOTE_URL.test(v)) found.push(`<${tag} ${name}=${attr.value}>`);
      if (name !== "data-blocked-src" && REMOTE_CSS.test(attr.value)) found.push(`<${tag} ${name}=${attr.value}>`);
      if (name === "style" && attr.value.includes("//")) found.push(`<${tag} style=${attr.value}>`);
    }
  }
  return found;
}

const run = (html: string, allowRemote: boolean) => sanitizeEmailHtml(html, { allowRemote });

describe("hostile corpus", () => {
  it("is large enough to mean something", () => {
    expect(CORPUS_ENTRIES.length).toBeGreaterThanOrEqual(90);
  });

  // V-1. The sanitizer is the only barrier between attacker HTML and a privileged renderer.
  describe.each(MODES)("V-1: nothing live survives the renderer's reparse ($label)", ({ allowRemote }) => {
    it.each(CORPUS_ENTRIES)("%s", (_name, entry) => {
      const { html } = run(entry.html, allowRemote);
      expect(liveHazards(mount(html))).toEqual([]);
    });
  });

  // restoreBlockedContent() promotes stashed markers back into live attributes.
  // Whatever it promotes must pass the same checks.
  describe("V-1: nothing live survives restoring blocked content", () => {
    it.each(CORPUS_ENTRIES)("%s", (_name, entry) => {
      const { html } = run(entry.html, false);
      const container = mount(html);
      restoreBlockedContent(container);
      expect(liveHazards(container)).toEqual([]);
    });
  });

  // A marker the sender supplied must never become a live attribute.
  describe("forged data-blocked-* markers", () => {
    it.each(["forgedMarkerSrc", "forgedMarkerHref", "forgedMarkerJs"])("%s is dropped in both modes", (name) => {
      for (const { allowRemote } of MODES) {
        const container = mount(run(HOSTILE_CORPUS[name].html, allowRemote).html);
        const markers = Array.from(container.querySelectorAll("*")).flatMap((el) =>
          el.getAttributeNames().filter((n) => n.startsWith("data-blocked-")),
        );
        expect(markers).toEqual([]);
        restoreBlockedContent(container);
        expect(remoteReferences(container)).toEqual([]);
      }
    });

    it("never leaves a marker behind when remote content is allowed", () => {
      for (const [, entry] of CORPUS_ENTRIES) {
        expect(run(entry.html, true).html).not.toContain("data-blocked-");
      }
    });
  });

  // V-3. With remote content blocked, a remote reference in the output must at least raise the banner.
  describe("V-3: a surviving remote reference raises the banner (remote blocked)", () => {
    const covered = CORPUS_ENTRIES.filter(([, e]) => !e.gap);

    it.each(covered)("%s", (_name, entry) => {
      const result = run(entry.html, false);
      if (remoteReferences(mount(result.html)).length > 0) {
        expect(result.blockedRemoteContent).toBe(true);
      }
    });

    it.each(covered.filter(([, e]) => e.remote))("flags remote content: %s", (_name, entry) => {
      expect(run(entry.html, false).blockedRemoteContent).toBe(true);
    });

    it("does not flag mail with nothing remote in it", () => {
      for (const name of ["plainText", "anchorBasic", "anchorMailto", "anchorCid", "unclosed", "empty"]) {
        expect(run(HOSTILE_CORPUS[name].html, false).blockedRemoteContent).toBe(false);
      }
    });
  });

  // Known violations (threat model T-3 / V-3), tracked here rather than hidden. `it.fails` passes while the
  // violation exists and starts failing when it is fixed. When that happens, delete the `.fails`, move the
  // entry into the passing groups above, and update V-3 in the threat model.
  describe("known gap T-3: remote content that reaches the output with no banner", () => {
    it("lists the entries it tracks", () => {
      expect(KNOWN_GAP_ENTRIES.map(([name]) => name).sort()).toEqual(["feImageHref", "newlineScheme", "tabScheme"]);
    });

    it.fails.each(KNOWN_GAP_ENTRIES)("%s should raise the banner (it does not yet)", (_name, entry) => {
      // The same invariant as the covered entries above. Either flagging the reference or stripping it fixes the gap.
      const result = run(entry.html, false);
      if (remoteReferences(mount(result.html)).length > 0) {
        expect(result.blockedRemoteContent).toBe(true);
      }
    });
  });

  // Reparse stability: sanitizing already-sanitized output must change nothing. A payload that mutates
  // on the second pass is the signature of mutation XSS.
  describe("sanitizing the output again changes nothing (remote allowed)", () => {
    it.each(CORPUS_ENTRIES)("%s", (_name, entry) => {
      const first = run(entry.html, true).html;
      expect(run(first, true).html).toBe(first);
    });
  });

  // DOMPurify 3.4.18 removed `enterkeyhint`, `exportparts`, `inputmode` and `part` from its SVG *tag*
  // allow-list (they are attribute names). The attributes themselves are unaffected.
  describe("attribute names are not kept as SVG elements", () => {
    it("drops <enterkeyhint>, <exportparts>, <inputmode> and <part> but keeps real elements", () => {
      const container = mount(run(HOSTILE_CORPUS.svgBogusTags.html, true).html);
      for (const tag of ["enterkeyhint", "exportparts", "inputmode", "part"]) {
        expect(container.querySelector(tag)).toBeNull();
      }
      expect(container.querySelector("rect")).not.toBeNull();
    });
  });

  // Pins current behaviour: the plugin's ALLOWED_URI_REGEXP lists raster types only, but DOMPurify's own data-URI
  // exception for image elements admits SVG. That is inert on <img> (image mode), and it is the only place it is
  // accepted: the same URI on a link is stripped (see "links" below).
  it("keeps an SVG data: URI on <img>, which renders in image mode, but not on a link", () => {
    const img = mount(run(HOSTILE_CORPUS.dataSvgImg.html, true).html).querySelector("img");
    expect(img?.getAttribute("src")).toMatch(/^data:image\/svg\+xml;base64,/);
    const a = mount(run(`<a href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">x</a>`, true).html).querySelector("a");
    expect(a?.getAttribute("href") ?? null).toBeNull();
  });

  // Escaped markup is text, not markup. This is the case a naive substring check gets wrong.
  it("renders CDATA inside SVG as inert text", () => {
    const container = mount(run(HOSTILE_CORPUS.cdataSvg.html, true).html);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("onerror=alert(1)");
  });

  // Link handling the renderer relies on.
  describe("links", () => {
    it("keeps https, mailto and tel hrefs on anchors, forcing target and rel", () => {
      for (const name of ["anchorBasic", "anchorMailto", "anchorTel"]) {
        const a = mount(run(HOSTILE_CORPUS[name].html, false).html).querySelector("a")!;
        expect(a.getAttribute("href")).toBeTruthy();
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      }
    });

    it.each(["jsHref", "jsHrefEntity", "jsHrefTab", "vbHref", "dataHtmlHref", "anchorFile", "anchorObsidian"])(
      "strips the href from %s",
      (name) => {
        const a = mount(run(HOSTILE_CORPUS[name].html, false).html).querySelector("a");
        expect(a?.getAttribute("href") ?? null).toBeNull();
      },
    );
  });
});
