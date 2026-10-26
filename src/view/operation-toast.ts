import { Notice, setIcon } from "obsidian";

export interface OperationToast {
  /** Rewrites the text in place — a progress tick, not a new toast. */
  update(text: string): void;
  /** Dismisses the toast. Safe to call more than once. */
  hide(): void;
}

/** A persistent (duration 0) toast for a running delete/archive/move. Built
 *  like `showSyncingToast`, but its text can be updated as the work advances. */
export function showOperationToast(text: string): OperationToast {
  const frag = document.createDocumentFragment();
  const iconEl = document.createElement("span");
  iconEl.classList.add("oe-toast-icon", "oe-spin");
  setIcon(iconEl, "loader");
  const textNode = document.createTextNode(text);
  frag.appendChild(iconEl);
  frag.appendChild(textNode);
  const notice = new Notice(frag, 0);
  let hidden = false;
  return {
    update(next) {
      if (!hidden) textNode.data = next;
    },
    hide() {
      if (hidden) return;
      hidden = true;
      notice.hide();
    },
  };
}
