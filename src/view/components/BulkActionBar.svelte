<script lang="ts">
  import { ACTION_ICON } from "../action-icons";
  import { icon } from "../icon-action";
  import type { Mailbox } from "../../providers/types";

  let {
    count, total, moveTargets, showArchive,
    onSelectAll, onClear, onMarkRead, onMarkUnread, onArchive, onDelete, onMove,
  }: {
    /** Conversations currently ticked. */
    count: number;
    /** Conversations loaded in the list — "Select all" is offered below this. */
    total: number;
    /** Every mailbox except the active one. */
    moveTargets: Mailbox[];
    showArchive: boolean;
    onSelectAll: () => void;
    onClear: () => void;
    onMarkRead: () => void;
    onMarkUnread: () => void;
    onArchive: () => void;
    onDelete: () => void;
    onMove: (destinationMailboxId: string) => void;
  } = $props();

  function handleMove(e: Event & { currentTarget: HTMLSelectElement }): void {
    const select = e.currentTarget;
    const destination = select.value;
    // Back to the "Move to…" prompt so the control reads as an action, not a setting.
    select.value = "";
    if (destination) onMove(destination);
  }
</script>

<div class="oe-bulk-bar" role="toolbar" aria-label="Actions for the selected conversations">
  <span class="oe-bulk-count" aria-live="polite">{count} selected</span>
  {#if count < total}
    <button type="button" data-action="select-all" onclick={onSelectAll}>Select all</button>
  {/if}
  <button type="button" data-action="mark-unread" onclick={onMarkUnread}>
    <span class="oe-action-icon" use:icon={ACTION_ICON.markUnread}></span>Unread
  </button>
  <button type="button" data-action="mark-read" onclick={onMarkRead}>
    <span class="oe-action-icon" use:icon={ACTION_ICON.markRead}></span>Read
  </button>
  {#if showArchive}
    <button type="button" data-action="archive" onclick={onArchive}>
      <span class="oe-action-icon" use:icon={ACTION_ICON.archive}></span>Archive
    </button>
  {/if}
  {#if moveTargets.length > 0}
    <select class="dropdown" data-action="move" aria-label="Move selected conversations to a folder" onchange={handleMove}>
      <option value="" selected disabled>Move to…</option>
      {#each moveTargets as box (box.id)}
        <option value={box.id}>{box.name}</option>
      {/each}
    </select>
  {/if}
  <button type="button" data-action="delete" onclick={onDelete}>
    <span class="oe-action-icon" use:icon={ACTION_ICON.delete}></span>Delete
  </button>
  <button type="button" data-action="clear" class="oe-bulk-clear" aria-label="Clear selection" title="Clear selection" onclick={onClear}>✕</button>
</div>
