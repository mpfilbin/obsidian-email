import DOMPurify from "dompurify";

export interface SanitizeResult {
  html: string;
  blockedRemoteContent: boolean;
}

const FORBID_TAGS = ["script", "iframe", "object", "embed", "form", "base", "meta", "link"];
const FORBID_ATTR = ["srcset", "ping", "background"];

function isRemote(url: string): boolean {
  return /^https?:/i.test(url.trim());
}

export function sanitizeEmailHtml(raw: string, opts: { allowRemote: boolean }): SanitizeResult {
  let blocked = false;

  const purify = DOMPurify(window);

  purify.addHook("uponSanitizeAttribute", (node, data) => {
    const name = data.attrName;
    const value = data.attrValue ?? "";

    // Neutralize remote url() in style attributes.
    if (name === "style" && /url\(\s*['"]?https?:/i.test(value)) {
      data.attrValue = value.replace(/url\(\s*['"]?https?:[^)]*\)/gi, "url()");
      if (!opts.allowRemote) blocked = true;
    }

    if (name === "src" && (node as Element).tagName === "IMG") {
      if (isRemote(value) && !opts.allowRemote) {
        blocked = true;
        // Store URL-encoded so the serialized attribute never contains a live
        // `src="http…"` substring; restoreBlockedContent() decodes it back.
        (node as Element).setAttribute("data-blocked-src", encodeURIComponent(value));
        data.attrValue = "";
        data.keepAttr = false;
      }
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

  const html = purify.sanitize(raw, {
    FORBID_TAGS,
    FORBID_ATTR,
    ADD_ATTR: ["target", "data-blocked-src"],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|data:image\/(?:png|jpe?g|gif|webp|bmp);|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  });

  purify.removeAllHooks();
  return { html, blockedRemoteContent: blocked };
}

export function restoreBlockedContent(container: HTMLElement): void {
  container.querySelectorAll<HTMLImageElement>("img[data-blocked-src]").forEach((img) => {
    const stored = img.getAttribute("data-blocked-src")!;
    let src = stored;
    try {
      src = decodeURIComponent(stored);
    } catch {
      src = stored;
    }
    img.setAttribute("src", src);
    img.removeAttribute("data-blocked-src");
  });
}
