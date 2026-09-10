import type { MessageBody } from "../providers/types";
import { restoreBlockedContent, sanitizeEmailHtml } from "./html-sanitizer";

export interface RenderDeps {
  getInlineAttachment: (contentId: string) => Promise<Blob | undefined>;
  openExternal: (url: string) => void;
}

export interface RenderHandle {
  blockedRemoteContent: boolean;
  loadRemoteImages(): void;
  dispose(): void;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function renderMessageBody(
  container: HTMLElement,
  body: MessageBody,
  opts: { allowRemote: boolean },
  deps: RenderDeps,
): RenderHandle {
  container.classList.add("obsidian-email-message-body");
  const objectUrls: string[] = [];
  let disposed = false;

  const bindLinks = (): void => {
    container.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        deps.openExternal(a.getAttribute("href")!);
      });
    });
  };

  const resolveCids = (): void => {
    const inline = new Map(
      body.attachments.filter((a) => a.inline && a.contentId).map((a) => [a.contentId!, a]),
    );
    container.querySelectorAll<HTMLImageElement>('img[src^="cid:"]').forEach((img) => {
      const cid = img.getAttribute("src")!.slice(4).replace(/^<|>$/g, "");
      if (!inline.has(cid)) return;
      void deps.getInlineAttachment(cid).then((blob) => {
        if (disposed || !blob) return;
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        img.setAttribute("src", url);
      });
    });
  };

  const paint = (allowRemote: boolean): boolean => {
    if (body.html) {
      const { html, blockedRemoteContent } = sanitizeEmailHtml(body.html, { allowRemote });
      container.innerHTML = html;
      bindLinks();
      resolveCids();
      return blockedRemoteContent;
    }
    container.innerHTML = `<pre class="obsidian-email-plaintext">${escapeHtml(body.text ?? "")}</pre>`;
    return false;
  };

  const blockedRemoteContent = paint(opts.allowRemote);

  return {
    blockedRemoteContent,
    loadRemoteImages(): void {
      // Fast path: if the DOM still has blocked markers, just swap them.
      if (container.querySelector("img[data-blocked-src]")) {
        restoreBlockedContent(container);
        bindLinks();
        return;
      }
      paint(true);
    },
    dispose(): void {
      disposed = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.length = 0;
      container.innerHTML = "";
    },
  };
}
