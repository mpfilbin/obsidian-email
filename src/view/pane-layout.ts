export interface PaneWidths {
  mailboxes: number;
  messageList: number;
}

export const DEFAULT_PANE_WIDTHS: PaneWidths = { mailboxes: 200, messageList: 340 };

const MIN_MAILBOXES = 140;
const MAX_MAILBOXES = 400;
const MIN_MESSAGE_LIST = 220;
const MAX_MESSAGE_LIST = 640;

const STORAGE_KEY = "obsidian-email:pane-widths";

export function clampPaneWidths(w: PaneWidths): PaneWidths {
  return {
    mailboxes: Math.min(MAX_MAILBOXES, Math.max(MIN_MAILBOXES, Math.round(w.mailboxes))),
    messageList: Math.min(MAX_MESSAGE_LIST, Math.max(MIN_MESSAGE_LIST, Math.round(w.messageList))),
  };
}

/** Per-device UI chrome, not synced data — a missing/corrupt value just falls back to defaults. */
export function loadPaneWidths(): PaneWidths {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PANE_WIDTHS;
    const parsed = JSON.parse(raw) as Partial<PaneWidths>;
    return clampPaneWidths({
      mailboxes: parsed.mailboxes ?? DEFAULT_PANE_WIDTHS.mailboxes,
      messageList: parsed.messageList ?? DEFAULT_PANE_WIDTHS.messageList,
    });
  } catch {
    return DEFAULT_PANE_WIDTHS;
  }
}

export function savePaneWidths(w: PaneWidths): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
  } catch {
    /* best effort — a private/blocked storage context just won't remember pane sizes */
  }
}
