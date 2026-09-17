<script lang="ts">
  import type { ThreadView } from "../view-model";
  import ThreadRow from "./ThreadRow.svelte";

  let { threads, openThreadId, hasMore, loading, onOpen, onLoadMore, isDraftsMailbox, isArchiveMailbox, isTrashMailbox, onArchiveThread, onDeleteThread, onThreadContextMenu }: {
    threads: ThreadView[];
    openThreadId: string | null;
    hasMore: boolean;
    loading: boolean;
    onOpen: (threadId: string) => void;
    onLoadMore: () => void;
    isDraftsMailbox: boolean;
    isArchiveMailbox: boolean;
    isTrashMailbox: boolean;
    onArchiveThread: (threadId: string) => void;
    onDeleteThread: (threadId: string) => void;
    onThreadContextMenu: (evt: MouseEvent, threadId: string) => void;
  } = $props();

  let sentinel = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!sentinel || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && hasMore && !loading) onLoadMore();
    });
    io.observe(sentinel);
    return () => io.disconnect();
  });
</script>

<div class="oe-message-list">
  {#if threads.length === 0 && !loading}
    <p class="oe-empty">No messages</p>
  {/if}
  {#each threads as t (t.threadId)}
    <ThreadRow
      thread={t}
      isOpen={t.threadId === openThreadId}
      onOpen={() => onOpen(t.threadId)}
      {isDraftsMailbox}
      {isArchiveMailbox}
      {isTrashMailbox}
      onArchive={() => onArchiveThread(t.threadId)}
      onDelete={() => onDeleteThread(t.threadId)}
      onContextMenu={(evt) => onThreadContextMenu(evt, t.threadId)}
    />
  {/each}
  {#if loading}<p class="oe-loading">Loading…</p>{/if}
  {#if hasMore}
    <div bind:this={sentinel}></div>
    <button class="oe-load-more" onclick={onLoadMore}>Load more</button>
  {/if}
</div>
