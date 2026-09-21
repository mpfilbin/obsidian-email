/** Lucide icon ids (via Obsidian's `setIcon`) for message/thread action
 *  buttons — shared between ReadingPane's action bar and ThreadRow's
 *  per-row buttons so both stay visually consistent. */
export const ACTION_ICON = {
  reply: "reply",
  replyAll: "reply-all",
  forward: "forward",
  archive: "archive",
  delete: "trash-2",
  editDraft: "pencil",
  collapse: "x",
  saveToVault: "save",
  flag: "flag",
  unflag: "flag-off",
} as const;
