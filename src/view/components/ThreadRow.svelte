<script lang="ts">
  import { ACTION_ICON } from "../action-icons";
  import { icon } from "../icon-action";
  import type { ThreadView } from "../view-model";
  import { describeFollowUp } from "../../util/follow-up";

  import { THREAD_DRAG_TYPE } from "../drag-types";

  let { thread, isOpen, onOpen, isDraftsMailbox, isArchiveMailbox, isTrashMailbox, onArchive, onDelete, onToggleFlag, onTogglePin, onContextMenu, selected = false, selectionActive = false, onSelect = () => {}, pending = false, keyHints = false }: {
    /** Show each action button's shortcut key in its tooltip. */
    keyHints?: boolean;
    /** A delete/archive/move of this thread is on its way to the server. */
    pending?: boolean;
    thread: ThreadView; isOpen: boolean; onOpen: () => void;
    /** This row is ticked for a bulk action. */
    selected?: boolean;
    /** Some row is ticked, so every row shows its checkbox. */
    selectionActive?: boolean;
    /** Tick/untick this row, or tick the range from the last-ticked row. */
    onSelect?: (mode: "toggle" | "range") => void;
    isDraftsMailbox: boolean; isArchiveMailbox: boolean; isTrashMailbox: boolean;
    onArchive: () => void; onDelete: () => void; onToggleFlag: () => void; onTogglePin: () => void;
    onContextMenu: (evt: MouseEvent) => void;
  } = $props();

  const newest = $derived(thread.messages[thread.messages.length - 1]);
  const sender = $derived(newest.from.name || newest.from.email || "(unknown)");
  const hasAttachments = $derived(thread.messages.some((m) => m.hasAttachments));
  const flagged = $derived(thread.messages.some((m) => m.flagged));
  const due = $derived(flagged && thread.flagDue !== undefined ? describeFollowUp(thread.flagDue, Date.now()) : null);
  const pinned = $derived(thread.pinned ?? false);
  const tip = (label: string, key: string): string => (keyHints ? `${label} (${key})` : label);
  const showArchive = $derived(!isDraftsMailbox && !isArchiveMailbox && !isTrashMailbox);

  // Ctrl/Cmd-click ticks the row, Shift-click ticks a range, a plain click
  // opens it — the same modifiers file managers and mail clients use.
  function handleClick(e: MouseEvent): void {
    if (pending) return;
    if (e.shiftKey) onSelect("range");
    else if (e.ctrlKey || e.metaKey) onSelect("toggle");
    else onOpen();
  }
  function handleKeydown(e: KeyboardEvent): void {
    if (pending) return;
    if (e.key === "Enter") onOpen();
    else if (e.key === " ") { e.preventDefault(); onSelect("toggle"); }
  }

  function relative(ts: number): string {
    const diff = Date.now() - ts;
    const min = 60_000, hr = 3_600_000, day = 86_400_000;
    if (diff < hr) return `${Math.max(1, Math.round(diff / min))}m`;
    if (diff < day) return `${Math.round(diff / hr)}h`;
    if (diff < 7 * day) return `${Math.round(diff / day)}d`;
    return new Date(ts).toLocaleDateString();
  }
</script>

<div
  class="oe-thread-row"
  data-thread-id={thread.threadId}
  class:is-unread={thread.unread}
  class:is-open={isOpen}
  class:is-pinned={pinned}
  class:is-selected={selected}
  class:selection-active={selectionActive}
  class:is-pending={pending}
  aria-busy={pending}
  onclick={handleClick}
  role="button"
  tabindex="0"
  onkeydown={handleKeydown}
  // A shift-click would otherwise also start a text selection across rows.
  onmousedown={(e) => { if (e.shiftKey) e.preventDefault(); }}
  oncontextmenu={(e) => { e.preventDefault(); if (!pending) onContextMenu(e); }}
  draggable={pending ? "false" : "true"}
  ondragstart={(e) => e.dataTransfer?.setData(THREAD_DRAG_TYPE, thread.threadId)}
>
  <input
    type="checkbox" class="oe-row-check" aria-label="Select conversation: {thread.subject}"
    checked={selected}
    disabled={pending}
    onclick={(e) => { e.stopPropagation(); onSelect(e.shiftKey ? "range" : "toggle"); }}
    onkeydown={(e) => e.stopPropagation()}
  />
  <div class="oe-thread-line1">
    <span class="oe-thread-sender">{sender}</span>
    <span class="oe-thread-date">{relative(thread.lastDate)}</span>
  </div>
  <div class="oe-thread-line2">
    {#if thread.unread}<span class="oe-dot" aria-label="unread">●</span>{/if}
    <span class="oe-thread-subject">{thread.subject}</span>
    {#if thread.messages.length > 1}<span class="oe-thread-count">{thread.messages.length}</span>{/if}
    {#if hasAttachments}<span class="oe-clip" aria-label="has attachments">📎</span>{/if}
    {#if flagged}<span class="oe-flag" role="img" aria-label="flagged" use:icon={ACTION_ICON.flag}></span>{/if}
    {#if due}<span class="oe-flag-due" class:is-overdue={due.overdue}>{due.text}</span>{/if}
    {#if pinned}<span class="oe-pin" role="img" aria-label="pinned" use:icon={ACTION_ICON.pin}></span>{/if}
  </div>
  <div class="oe-thread-snippet">{newest.snippet}</div>
  {#if pending}
    <div class="oe-thread-actions oe-thread-pending" role="status">
      <span class="oe-row-spinner" use:icon={ACTION_ICON.pending}></span>Working…
    </div>
  {:else}
  <div class="oe-thread-actions">
    <button type="button" data-action="flag" title={tip(flagged ? "Unflag" : "Flag", "f")} aria-pressed={flagged} onclick={(e) => { e.stopPropagation(); onToggleFlag(); }} onkeydown={(e) => e.stopPropagation()}>
      <span class="oe-action-icon" use:icon={flagged ? ACTION_ICON.unflag : ACTION_ICON.flag}></span>{flagged ? "Unflag" : "Flag"}
    </button>
    <button type="button" data-action="pin" title={tip(pinned ? "Unpin" : "Pin", "p")} aria-pressed={pinned} onclick={(e) => { e.stopPropagation(); onTogglePin(); }} onkeydown={(e) => e.stopPropagation()}>
      <span class="oe-action-icon" use:icon={pinned ? ACTION_ICON.unpin : ACTION_ICON.pin}></span>{pinned ? "Unpin" : "Pin"}
    </button>
    {#if showArchive}
      <button type="button" data-action="archive" title={tip("Archive", "e")} onclick={(e) => { e.stopPropagation(); onArchive(); }} onkeydown={(e) => e.stopPropagation()}>
        <span class="oe-action-icon" use:icon={ACTION_ICON.archive}></span>Archive
      </button>
    {/if}
    <button type="button" data-action="delete" title={tip("Delete", "#")} onclick={(e) => { e.stopPropagation(); onDelete(); }} onkeydown={(e) => e.stopPropagation()}>
      <span class="oe-action-icon" use:icon={ACTION_ICON.delete}></span>Delete
    </button>
  </div>
  {/if}
</div>
