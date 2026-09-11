import { setIcon } from "obsidian";
import type { Action } from "svelte/action";

/** `use:icon={iconId}` — renders an Obsidian/Lucide icon into the element. */
export const icon: Action<HTMLElement, string> = (node, iconId) => {
  setIcon(node, iconId);
  return {
    update(next) {
      setIcon(node, next);
    },
  };
};
