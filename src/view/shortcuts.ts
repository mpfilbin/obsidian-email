/** What a keyboard shortcut (or the matching palette command) can do. */
export type KeyAction = "next" | "previous" | "select" | "read" | "flag" | "pin" | "archive" | "delete";

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
}

const KEY_ACTION: Record<string, KeyAction> = {
  j: "next",
  k: "previous",
  x: "select",
  u: "read",
  f: "flag",
  p: "pin",
  e: "archive",
  "#": "delete",
  Delete: "delete",
};

/** The action a built-in shortcut stands for, or `null` for any other key.
 *  Held-key repeat is honoured for navigation only: a held `e` would archive
 *  its way down the whole list. Shift is not rejected — `#` needs it, and the
 *  letters are matched case-sensitively so `J` or caps lock never fire. */
export function keyToAction(e: KeyLike): KeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const action = KEY_ACTION[e.key];
  if (!action) return null;
  if (e.repeat && action !== "next" && action !== "previous") return null;
  return action;
}

/** Keystrokes aimed at a text field (search box, composer editor, contact and
 *  rename forms) belong to that field. */
export function shouldIgnoreTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select")) return true;
  // `isContentEditable` isn't implemented by jsdom, so ask the attribute.
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/** The conversation `direction` rows from `fromId`, in list order, skipping
 *  `skip` (rows that are mid-delete). With nothing open — or an id that is no
 *  longer in the list — `next` is the first row and `previous` is nothing.
 *  Doesn't wrap. */
export function adjacentThreadId(
  threads: ReadonlyArray<{ threadId: string }>,
  fromId: string | null,
  direction: 1 | -1,
  skip: ReadonlySet<string> = new Set(),
): string | null {
  const from = fromId === null ? -1 : threads.findIndex((t) => t.threadId === fromId);
  if (from === -1) {
    if (direction === -1) return null;
    return threads.find((t) => !skip.has(t.threadId))?.threadId ?? null;
  }
  for (let i = from + direction; i >= 0 && i < threads.length; i += direction) {
    if (!skip.has(threads[i].threadId)) return threads[i].threadId;
  }
  return null;
}

/** Where to go after the open conversation is archived or deleted: the next
 *  row, else the nearest earlier one, else nothing. */
export function advanceTarget(
  threads: ReadonlyArray<{ threadId: string }>,
  openId: string,
  skip: ReadonlySet<string> = new Set(),
): string | null {
  if (!threads.some((t) => t.threadId === openId)) return null;
  return adjacentThreadId(threads, openId, 1, skip) ?? adjacentThreadId(threads, openId, -1, skip);
}
