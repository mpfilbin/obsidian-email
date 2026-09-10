<script lang="ts">
  import type { ThreadView } from "../view-model";

  // Minimal stub — Task 25 replaces the body with the real virtualised list.
  // It renders enough (subject + sender) for the App shell smoke test.
  let { threads = [], openThreadId = null, onOpen }: {
    threads?: ThreadView[];
    openThreadId?: string | null;
    hasMore?: boolean;
    loading?: boolean;
    onOpen?: (id: string) => void;
    onLoadMore?: () => void;
  } = $props();

  const sender = (t: ThreadView) =>
    t.messages[0]?.from.name ?? t.messages[0]?.from.email ?? "";
</script>

<div class="oe-message-list">
  {#each threads as t (t.threadId)}
    <button
      class="oe-thread-row"
      class:is-unread={t.unread}
      class:is-open={t.threadId === openThreadId}
      onclick={() => onOpen?.(t.threadId)}
    >
      <span class="oe-thread-sender">{sender(t)}</span>
      <span class="oe-thread-subject">{t.subject}</span>
    </button>
  {/each}
</div>
