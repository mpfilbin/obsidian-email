import { describe, it, expect, vi } from "vitest";
import { makeOpenEmailLink, makeWebViewer } from "../../src/host/links";

function fakeApp(enabled: boolean | "no-api" = true) {
  const setViewState = vi.fn(async () => {});
  const getLeaf = vi.fn(() => ({ setViewState }));
  const app: Record<string, unknown> = { workspace: { getLeaf } };
  if (enabled !== "no-api") {
    app.internalPlugins = { getEnabledPluginById: vi.fn((id: string) => (enabled && id === "webviewer" ? {} : undefined)) };
  }
  return { app: app as never, getLeaf, setViewState };
}

describe("makeWebViewer", () => {
  it("reports whether the core Web viewer plugin is enabled", () => {
    expect(makeWebViewer(fakeApp(true).app).isWebViewerEnabled()).toBe(true);
    expect(makeWebViewer(fakeApp(false).app).isWebViewerEnabled()).toBe(false);
  });

  it("treats a missing or reshaped internalPlugins API as 'not enabled' rather than throwing", () => {
    expect(makeWebViewer(fakeApp("no-api").app).isWebViewerEnabled()).toBe(false);
    expect(makeWebViewer({ internalPlugins: {}, workspace: {} } as never).isWebViewerEnabled()).toBe(false);
  });

  it("opens a URL in a new tab's webviewer", () => {
    const { app, getLeaf, setViewState } = fakeApp(true);
    makeWebViewer(app).openInWebViewer("https://example.com/x");
    expect(getLeaf).toHaveBeenCalledWith("tab");
    expect(setViewState).toHaveBeenCalledWith({ type: "webviewer", active: true, state: { url: "https://example.com/x", navigate: true } });
  });
});

describe("makeOpenEmailLink", () => {
  it("sends http(s) links to the Web viewer when it is enabled", () => {
    const { app, setViewState } = fakeApp(true);
    const openExternal = vi.fn();
    makeOpenEmailLink(app, openExternal)("https://example.com");
    expect(setViewState).toHaveBeenCalledOnce();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("falls back to the system browser when the Web viewer is off or unavailable", () => {
    for (const mode of [false, "no-api"] as const) {
      const { app, setViewState } = fakeApp(mode);
      const openExternal = vi.fn();
      makeOpenEmailLink(app, openExternal)("https://example.com");
      expect(openExternal).toHaveBeenCalledWith("https://example.com");
      expect(setViewState).not.toHaveBeenCalled();
    }
  });

  it("always sends non-http links (mailto:) to the system", () => {
    const { app, setViewState } = fakeApp(true);
    const openExternal = vi.fn();
    makeOpenEmailLink(app, openExternal)("mailto:a@x.com");
    expect(openExternal).toHaveBeenCalledWith("mailto:a@x.com");
    expect(setViewState).not.toHaveBeenCalled();
  });
});
