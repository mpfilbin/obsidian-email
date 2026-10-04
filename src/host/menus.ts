import type { MailboxContextMenuHandler, ThreadContextMenuHandler } from "../view/mail-view";
import { followUpPresets } from "../util/follow-up";

// Structural stand-ins for Obsidian's `Menu`/`MenuItem`, so the menus can be
// built (and tested) without the real class.
export interface MenuItemLike {
  setTitle(title: string): this;
  setIcon(icon: string): this;
  setWarning(isWarning: boolean): this;
  onClick(cb: () => void): this;
}
export interface MenuLike {
  addItem(cb: (item: MenuItemLike) => void): this;
  showAtMouseEvent(evt: MouseEvent): void;
  showAtPosition(position: { x: number; y: number }): void;
}

export interface MenuHost {
  newMenu: () => MenuLike;
  openExternal: (url: string) => void;
  promptFolderRename: (currentName: string, onSubmit: (name: string) => void) => void;
  now?: () => number;
}

export function makeMenus(host: MenuHost): {
  showLinkContextMenu: (evt: MouseEvent, url: string) => void;
  showMailboxContextMenu: MailboxContextMenuHandler;
  showThreadContextMenu: ThreadContextMenuHandler;
} {
  const now = host.now ?? Date.now;

  const showLinkContextMenu = (evt: MouseEvent, url: string): void => {
    const menu = host.newMenu();
    menu.addItem((item) =>
      item.setTitle("Open in default browser").setIcon("external-link").onClick(() => host.openExternal(url)),
    );
    menu.showAtMouseEvent(evt);
  };

  const showMailboxContextMenu: MailboxContextMenuHandler = (evt, currentName, onRename, onDelete) => {
    const menu = host.newMenu();
    menu.addItem((item) =>
      item
        .setTitle("Rename")
        .setIcon("pencil")
        .onClick(() => host.promptFolderRename(currentName, onRename)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Delete")
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => onDelete()),
    );
    menu.showAtMouseEvent(evt);
  };

  // Obsidian's public Menu API has no submenu support, so "Move" and "Follow
  // up" open a second menu chained off the same click rather than nesting one —
  // the closest native-feeling equivalent. Pure presentation: the actual action
  // (with its unsaved-composer and reading-pane-collapse guards) happens back
  // in App.svelte via the supplied callbacks.
  //
  // The chained menu is positioned from the ORIGINAL right-click's
  // coordinates, captured up front, rather than from the item's own click
  // event: on desktop a MenuItem can be backed by a native OS menu, whose click
  // callback doesn't carry a real DOM mouse position — using it for
  // showAtMouseEvent put the submenu at (0, 0) instead of near the row.
  const showThreadContextMenu: ThreadContextMenuHandler = (
    evt,
    { candidates, onMove, flagged, onToggleFlag, onFlagFollowUp, onFlagCustomFollowUp, onCompleteFlag, pinned, onTogglePin },
  ) => {
    const position = { x: evt.clientX, y: evt.clientY };
    const menu = host.newMenu();
    menu.addItem((item) =>
      item
        .setTitle(flagged ? "Remove flag" : "Flag")
        .setIcon(flagged ? "flag-off" : "flag")
        .onClick(() => onToggleFlag()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Follow up")
        .setIcon("calendar-clock")
        .onClick(() => {
          const followMenu = host.newMenu();
          for (const preset of followUpPresets(now())) {
            followMenu.addItem((i) => i.setTitle(preset.label).onClick(() => onFlagFollowUp(preset.dueDate)));
          }
          followMenu.addItem((i) => i.setTitle("Custom date…").onClick(() => onFlagCustomFollowUp()));
          followMenu.showAtPosition(position);
        }),
    );
    if (flagged) {
      menu.addItem((item) =>
        item.setTitle("Mark complete").setIcon("check-circle").onClick(() => onCompleteFlag()),
      );
    }
    menu.addItem((item) =>
      item
        .setTitle(pinned ? "Unpin" : "Pin")
        .setIcon(pinned ? "pin-off" : "pin")
        .onClick(() => onTogglePin()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Move")
        .setIcon("folder-input")
        .onClick(() => {
          const folderMenu = host.newMenu();
          for (const box of candidates) {
            folderMenu.addItem((folderItem) => folderItem.setTitle(box.name).onClick(() => onMove(box.id)));
          }
          folderMenu.showAtPosition(position);
        }),
    );
    menu.showAtMouseEvent(evt);
  };

  return { showLinkContextMenu, showMailboxContextMenu, showThreadContextMenu };
}
