import { Notice, setIcon } from "obsidian";

/** Shows a persistent (duration 0) toast for the life of a sync — call
 *  `.hide()` on the returned Notice once syncing ends. Used in place of the
 *  old spin/ring animations on the refresh button and account icon. */
export function showSyncingToast(): Notice {
  const frag = document.createDocumentFragment();
  const iconEl = document.createElement("span");
  iconEl.classList.add("oe-toast-icon");
  setIcon(iconEl, "mail");
  frag.appendChild(iconEl);
  frag.appendChild(document.createTextNode("Refreshing…"));
  return new Notice(frag, 0);
}
