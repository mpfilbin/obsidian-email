import DOMPurify from "dompurify";

export interface SanitizeResult {
  html: string;
  blockedRemoteContent: boolean;
}

const FORBID_TAGS = ["script", "iframe", "object", "embed", "form", "base", "meta", "link"];
const FORBID_ATTR = ["srcset", "ping", "background"];

// Elements whose `src` attribute triggers a network fetch on render.
const REMOTE_SRC_TAGS = new Set(["img", "image", "video", "audio", "source", "track", "input"]);

// data-blocked-* attribute name -> the real attribute it stands in for.
const BLOCKED_ATTR_MAP: Record<string, string> = {
  "data-blocked-src": "src",
  "data-blocked-poster": "poster",
  "data-blocked-href": "href",
};

// Treat absolute http(s) URLs and protocol-relative `//host/...` URLs as remote.
// A bare path like `/foo` is NOT remote.
function isRemote(url: string): boolean {
  return /^(?:https?:)?\/\//i.test(url.trim());
}

// Shared instance: hooks are added per call and torn down in `finally` so stale
// `blocked` / `opts` closures never leak between calls.
const purify = DOMPurify(window);

export function sanitizeEmailHtml(raw: string, opts: { allowRemote: boolean }): SanitizeResult {
  let blocked = false;
  const { allowRemote } = opts;

  purify.addHook("uponSanitizeAttribute", (node, data) => {
    const el = node as Element;
    const tag = (el.tagName ?? "").toLowerCase();
    const name = data.attrName;
    const value = data.attrValue ?? "";

    // Neutralize remote url() in style attributes (only when remote is blocked).
    if (name === "style" && !allowRemote && /url\(\s*['"]?(?:https?:)?\/\//i.test(value)) {
      data.attrValue = value.replace(/url\(\s*['"]?(?:https?:)?\/\/[^)]*\)/gi, "url()");
      blocked = true;
      return;
    }

    if (allowRemote) return;

    let blockedName: string | null = null;
    if (name === "src" && REMOTE_SRC_TAGS.has(tag)) blockedName = "data-blocked-src";
    else if (name === "poster" && tag === "video") blockedName = "data-blocked-poster";
    // SVG <image>/<use> load their referent via `href`. NOT <a>, whose href is a
    // navigation link handled by the renderer's link interception.
    else if (name === "href" && (tag === "image" || tag === "use")) blockedName = "data-blocked-href";

    if (blockedName && isRemote(value)) {
      blocked = true;
      // Store URL-encoded so the serialized attribute never contains a live
      // `src="http…"` substring; restoreBlockedContent() decodes it back.
      el.setAttribute(blockedName, encodeURIComponent(value));
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
      ADD_ATTR: ["target", "data-blocked-src", "data-blocked-poster", "data-blocked-href"],
      ALLOW_DATA_ATTR: false,
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|data:image\/(?:png|jpe?g|gif|webp|bmp);|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    });
    return { html, blockedRemoteContent: blocked };
  } finally {
    purify.removeAllHooks();
  }
}

export function restoreBlockedContent(container: HTMLElement): void {
  for (const [dataAttr, realAttr] of Object.entries(BLOCKED_ATTR_MAP)) {
    container.querySelectorAll<HTMLElement>(`[${dataAttr}]`).forEach((el) => {
      const stored = el.getAttribute(dataAttr)!;
      let value = stored;
      try {
        value = decodeURIComponent(stored);
      } catch {
        value = stored;
      }
      el.setAttribute(realAttr, value);
      el.removeAttribute(dataAttr);
    });
  }
}
