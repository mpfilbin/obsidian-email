import DOMPurify from "dompurify";

export interface SanitizeResult {
  html: string;
  blockedRemoteContent: boolean;
}

// `style` is forbidden: DOMPurify does not parse stylesheet text, so a
// `<style>` block would otherwise ship unscoped CSS into the live Obsidian
// document (`body{display:none}`) and fetch remote resources via `url()` /
// `@import` without ever tripping the remote-content blocker.
const FORBID_TAGS = ["script", "iframe", "object", "embed", "form", "base", "meta", "link", "style"];
const FORBID_ATTR = ["srcset", "ping", "background"];

// Elements whose `src` attribute triggers a network fetch on render.
const REMOTE_SRC_TAGS = new Set(["img", "image", "video", "audio", "source", "track", "input"]);

const XLINK_NS = "http://www.w3.org/1999/xlink";

// data-blocked-* attribute name -> the real attribute it stands in for.
const BLOCKED_ATTR_MAP: Record<string, string> = {
  "data-blocked-src": "src",
  "data-blocked-poster": "poster",
  "data-blocked-href": "href",
  "data-blocked-xlink-href": "xlink:href",
};

const BLOCKED_ATTR_NAMES = Object.keys(BLOCKED_ATTR_MAP);

// A CSS reference that fetches a remote resource. Covers `url(...)`,
// `image-set(...)` and `-webkit-image-set(...)`, quoted or bare, absolute or
// protocol-relative. A nested `image-set(url(https://…))` is caught by the
// inner `url(` match.
const REMOTE_CSS_REF = /(?:-webkit-)?(?:url|image-set)\(\s*['"]?\s*(?:https?:)?\/\/[^)]*\)/gi;
const REMOTE_CSS_IMPORT = /@import\s+(?:url\(\s*)?['"]?\s*(?:https?:)?\/\//i;

// Defense in depth (Rec 3): whatever the hooks did or failed to do, if a remote
// resource reference survives into the output we must say so, otherwise the
// "Load remote images" banner never appears and the user is never told.
// Deliberately excludes bare `href=` (only `<a>` keeps one after sanitizing —
// a link does not fetch) and the `title=` mirror the anchor hook adds.
const SURVIVING_REMOTE = [
  /\s(?:src|srcset|poster|background|data|formaction|xlink:href)\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<(?:image|use)\b[^>]*\shref\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /(?:-webkit-)?(?:url|image-set)\(\s*['"]?\s*(?:https?:)?\/\//i,
  REMOTE_CSS_IMPORT,
];

// Treat absolute http(s) URLs and protocol-relative `//host/...` URLs as remote.
// A bare path like `/foo` is NOT remote.
function isRemote(url: string): boolean {
  return /^(?:https?:)?\/\//i.test(url.trim());
}

function hasRemoteCss(css: string): boolean {
  REMOTE_CSS_REF.lastIndex = 0;
  return REMOTE_CSS_REF.test(css) || REMOTE_CSS_IMPORT.test(css);
}

// `<style>` blocks are dropped before any hook can see them: FORBID_TAGS
// force-removes the ones in <body>, and DOMPurify discards <head> outright, so
// a stylesheet's `url()` / `@import` never reaches the output scan. Detect them
// on the raw input instead, so the user is still told remote content was
// withheld.
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi;

function rawStyleHasRemote(raw: string): boolean {
  STYLE_BLOCK.lastIndex = 0;
  for (let m = STYLE_BLOCK.exec(raw); m; m = STYLE_BLOCK.exec(raw)) {
    if (hasRemoteCss(m[1])) return true;
  }
  return false;
}

// Shared instance: hooks are added per call and torn down in `finally` so stale
// `blocked` / `opts` closures never leak between calls.
const purify = DOMPurify(window);

export function sanitizeEmailHtml(raw: string, opts: { allowRemote: boolean }): SanitizeResult {
  const { allowRemote } = opts;
  let blocked = !allowRemote && rawStyleHasRemote(raw);

  // Marker attributes this pass stashed, per element. Anything named
  // `data-blocked-*` that is NOT in here came in with the email and must be
  // dropped — otherwise an attacker ships their own marker and
  // restoreBlockedContent() promotes it into a live attribute, bypassing
  // ALLOWED_URI_REGEXP entirely.
  const ownMarkers = new WeakMap<Element, Set<string>>();

  purify.addHook("uponSanitizeAttribute", (node, data) => {
    const el = node as Element;
    const tag = (el.tagName ?? "").toLowerCase();
    const name = data.attrName;
    const value = data.attrValue ?? "";

    // Reject incoming `data-blocked-*`: only markers this pass set are real.
    if (name.startsWith("data-blocked-")) {
      if (!ownMarkers.get(el)?.has(name)) {
        data.attrValue = "";
        data.keepAttr = false;
      }
      return;
    }

    // Neutralize remote url()/image-set() in style attributes (only when remote
    // is blocked).
    if (name === "style" && !allowRemote) {
      const cleaned = value.replace(REMOTE_CSS_REF, "url()");
      if (cleaned !== value) {
        data.attrValue = cleaned;
        blocked = true;
      }
      return;
    }

    if (allowRemote) return;

    let blockedName: string | null = null;
    if (name === "src" && REMOTE_SRC_TAGS.has(tag)) blockedName = "data-blocked-src";
    else if (name === "poster" && tag === "video") blockedName = "data-blocked-poster";
    // SVG <image>/<use> load their referent via `href` — or, in SVG 1.1, via
    // the namespaced `xlink:href`. NOT <a>, whose href is a navigation link
    // handled by the renderer's link interception.
    else if (name === "href" && (tag === "image" || tag === "use")) blockedName = "data-blocked-href";
    else if (name === "xlink:href" && (tag === "image" || tag === "use")) {
      blockedName = "data-blocked-xlink-href";
    }

    if (blockedName && isRemote(value)) {
      blocked = true;
      // Store URL-encoded so the serialized attribute never contains a live
      // `src="http…"` substring; restoreBlockedContent() decodes it back.
      el.setAttribute(blockedName, encodeURIComponent(value));
      const own = ownMarkers.get(el) ?? new Set<string>();
      own.add(blockedName);
      ownMarkers.set(el, own);
      data.attrValue = "";
      data.keepAttr = false;
    }
  });

  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      const href = node.getAttribute("href") ?? "";
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
      if (href && !node.getAttribute("title")) node.setAttribute("title", href);
    }
  });

  try {
    const html = purify.sanitize(raw, {
      FORBID_TAGS,
      FORBID_ATTR,
      ADD_ATTR: ["target", "xlink:href", ...BLOCKED_ATTR_NAMES],
      ALLOW_DATA_ATTR: false,
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|data:image\/(?:png|jpe?g|gif|webp|bmp);|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    });
    // Fail closed: anything remote that slipped past the hooks still flips the
    // flag so the user is told and can decide. We do not strip here — the DOM
    // is already serialized and a half-hearted string edit would be worse.
    if (!allowRemote && !blocked && SURVIVING_REMOTE.some((re) => re.test(html))) {
      blocked = true;
    }
    return { html, blockedRemoteContent: blocked };
  } finally {
    purify.removeAllHooks();
  }
}

export function restoreBlockedContent(container: HTMLElement): void {
  for (const [dataAttr, realAttr] of Object.entries(BLOCKED_ATTR_MAP)) {
    container.querySelectorAll<HTMLElement>(`[${dataAttr}]`).forEach((el) => {
      const stored = el.getAttribute(dataAttr)!;
      el.removeAttribute(dataAttr);
      let value = stored;
      try {
        value = decodeURIComponent(stored);
      } catch {
        value = stored;
      }
      // Re-validate: the block hook only ever stashes http(s) (or
      // protocol-relative) URLs, so anything else is a forged marker that
      // survived sanitizing. Drop it rather than promoting it.
      if (!isRemote(value)) return;
      if (realAttr === "xlink:href") el.setAttributeNS(XLINK_NS, "xlink:href", value);
      else el.setAttribute(realAttr, value);
    });
  }
}
