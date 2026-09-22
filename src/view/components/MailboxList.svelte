<script lang="ts">
  import type { Mailbox } from "../../providers/types";
  import { ACTION_ICON } from "../action-icons";
  import { THREAD_DRAG_TYPE } from "../drag-types";
  import { icon } from "../icon-action";
  import { mailboxIcon } from "../mailbox-icons";

  let { mailboxes, activeId, flaggedActive, onSelect, onSelectFlagged, onDropThread, onContextMenu }: {
    mailboxes: Mailbox[];
    activeId: string | null;
    flaggedActive: boolean;
    onSelect: (id: string) => void;
    onSelectFlagged: () => void;
    onDropThread: (threadId: string, destinationMailboxId: string) => void;
    /** Only fired for custom folders — Graph doesn't allow renaming the
     *  built-in ones (Inbox, Sent, Drafts, etc.). */
    onContextMenu: (evt: MouseEvent, mailboxId: string) => void;
  } = $props();

  let dragOverId = $state<string | null>(null);
</script>

<nav class="oe-mailboxes">
  <button
    type="button" class="oe-mailbox oe-mailbox-flagged" class:is-active={flaggedActive}
    data-view="flagged" onclick={onSelectFlagged}
  >
    <span class="oe-mailbox-icon" use:icon={ACTION_ICON.flag}></span>
    <span class="oe-mailbox-name">Flagged</span>
  </button>
  {#each mailboxes as mb (mb.id)}
    <button
      class="oe-mailbox"
      class:is-active={mb.id === activeId}
      class:is-drag-over={dragOverId === mb.id}
      onclick={() => onSelect(mb.id)}
      oncontextmenu={(e) => {
        if (mb.kind !== "custom") return;
        e.preventDefault();
        onContextMenu(e, mb.id);
      }}
      ondragover={(e) => {
        if (mb.id === activeId || !e.dataTransfer?.types.includes(THREAD_DRAG_TYPE)) return;
        e.preventDefault();
        dragOverId = mb.id;
      }}
      ondragleave={() => { if (dragOverId === mb.id) dragOverId = null; }}
      ondrop={(e) => {
        dragOverId = null;
        if (mb.id === activeId) return;
        const threadId = e.dataTransfer?.getData(THREAD_DRAG_TYPE);
        if (threadId) onDropThread(threadId, mb.id);
      }}
    >
      <span class="oe-mailbox-icon" use:icon={mailboxIcon(mb.kind)}></span>
      <span class="oe-mailbox-name">{mb.name}</span>
      {#if mb.unreadCount}<span class="oe-count">{mb.unreadCount}</span>{/if}
    </button>
  {/each}
</nav>
