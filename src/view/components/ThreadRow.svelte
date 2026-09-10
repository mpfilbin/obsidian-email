<script lang="ts">
  import type { ThreadView } from "../view-model";

  let { thread, isOpen, onOpen }: { thread: ThreadView; isOpen: boolean; onOpen: () => void } = $props();

  const newest = $derived(thread.messages[thread.messages.length - 1]);
  const sender = $derived(newest.from.name || newest.from.email || "(unknown)");
  const hasAttachments = $derived(thread.messages.some((m) => m.hasAttachments));

  function relative(ts: number): string {
    const diff = Date.now() - ts;
    const min = 60_000, hr = 3_600_000, day = 86_400_000;
    if (diff < hr) return `${Math.max(1, Math.round(diff / min))}m`;
    if (diff < day) return `${Math.round(diff / hr)}h`;
    if (diff < 7 * day) return `${Math.round(diff / day)}d`;
    return new Date(ts).toLocaleDateString();
  }
</script>

<button
  class="oe-thread-row"
  class:is-unread={thread.unread}
  class:is-open={isOpen}
  onclick={onOpen}
>
  <div class="oe-thread-line1">
    <span class="oe-thread-sender">{sender}</span>
    <span class="oe-thread-date">{relative(thread.lastDate)}</span>
  </div>
  <div class="oe-thread-line2">
    {#if thread.unread}<span class="oe-dot" aria-label="unread">●</span>{/if}
    <span class="oe-thread-subject">{thread.subject}</span>
    {#if thread.messages.length > 1}<span class="oe-thread-count">{thread.messages.length}</span>{/if}
    {#if hasAttachments}<span class="oe-clip" aria-label="has attachments">📎</span>{/if}
  </div>
  <div class="oe-thread-snippet">{newest.snippet}</div>
</button>
