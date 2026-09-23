export interface OpenEmailLinkDeps {
  isWebViewerEnabled: () => boolean;
  openInWebViewer: (url: string) => void;
  openExternal: (url: string) => void;
}

const HTTP_URL = /^https?:\/\//i;

export function openEmailLink(url: string, deps: OpenEmailLinkDeps): void {
  if (HTTP_URL.test(url) && deps.isWebViewerEnabled()) {
    deps.openInWebViewer(url);
    return;
  }
  deps.openExternal(url);
}
