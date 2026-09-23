import { describe, it, expect, vi } from "vitest";
import { openEmailLink } from "../../src/render/open-email-link";

const deps = (isWebViewerEnabled: boolean) => ({
  isWebViewerEnabled: () => isWebViewerEnabled,
  openInWebViewer: vi.fn(),
  openExternal: vi.fn(),
});

describe("openEmailLink", () => {
  it("opens an http(s) link in the Web Viewer when it's enabled", () => {
    const d = deps(true);
    openEmailLink("https://example.com", d);
    expect(d.openInWebViewer).toHaveBeenCalledWith("https://example.com");
    expect(d.openExternal).not.toHaveBeenCalled();
  });

  it("falls back to the default browser when the Web Viewer is disabled", () => {
    const d = deps(false);
    openEmailLink("https://example.com", d);
    expect(d.openExternal).toHaveBeenCalledWith("https://example.com");
    expect(d.openInWebViewer).not.toHaveBeenCalled();
  });

  it("falls back to the default browser for non-http(s) schemes even when the Web Viewer is enabled", () => {
    const d = deps(true);
    openEmailLink("mailto:someone@example.com", d);
    expect(d.openExternal).toHaveBeenCalledWith("mailto:someone@example.com");
    expect(d.openInWebViewer).not.toHaveBeenCalled();
  });
});
