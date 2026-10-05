import type { App } from "obsidian";
import { openEmailLink } from "../render/open-email-link";

/** The one place that touches Obsidian's non-public `internalPlugins`: whether
 *  the core "Web viewer" plugin is on. Optional-chained throughout — an API
 *  absent or reshaped in some version/environment must fall back to the system
 *  browser, never throw. */
export function makeWebViewer(app: App): {
  isWebViewerEnabled: () => boolean;
  openInWebViewer: (url: string) => void;
} {
  const { internalPlugins } = app as unknown as {
    internalPlugins?: { getEnabledPluginById?(id: string): unknown };
  };
  return {
    isWebViewerEnabled: () => !!internalPlugins?.getEnabledPluginById?.("webviewer"),
    openInWebViewer: (url) => {
      void app.workspace.getLeaf("tab").setViewState({
        type: "webviewer",
        active: true,
        state: { url, navigate: true },
      });
    },
  };
}

/** Opens a link from an email: the Web viewer when it's enabled, else the
 *  system browser. */
export function makeOpenEmailLink(app: App, openExternal: (url: string) => void): (url: string) => void {
  const { isWebViewerEnabled, openInWebViewer } = makeWebViewer(app);
  return (url) => openEmailLink(url, { isWebViewerEnabled, openInWebViewer, openExternal });
}
