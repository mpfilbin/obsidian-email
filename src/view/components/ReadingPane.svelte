<script lang="ts">
  import type { AttachmentMeta } from "../../providers/types";
  import type { ViewState } from "../view-model";
  import MessageBlock from "./MessageBlock.svelte";

  let { openMessages, renderDeps, onClose, onDownload }: {
    openMessages: ViewState["openMessages"];
    renderDeps: { getInlineAttachment: (cid: string) => Promise<Blob | undefined>; openExternal: (url: string) => void };
    onClose: () => void;
    onDownload: (messageId: string, att: AttachmentMeta) => void;
  } = $props();

  let expandedId = $state<string | null>(null);
  const lastId = $derived(openMessages.at(-1)?.summary.id ?? null);
  const isExpanded = (id: string) => (expandedId ?? lastId) === id;

  // Reset manual expansion whenever the open thread changes (tracked by its first
  // message id) so a stale id from a previous thread doesn't leave every block in
  // the new thread collapsed. Keyed on the first id rather than the openMessages
  // identity so per-message body loads within one thread don't clear expansion.
  let threadKey: string | null = null;
  $effect(() => {
    const firstId = openMessages[0]?.summary.id ?? null;
    if (firstId !== threadKey) {
      threadKey = firstId;
      expandedId = null;
    }
  });
</script>

<section class="oe-reading-pane">
  {#if openMessages.length === 0}
    <p class="oe-empty">Select a message to read</p>
  {:else}
    <header class="oe-reading-head">
      <h3>{openMessages.at(-1)?.summary.subject}</h3>
      <span>{openMessages.length} message{openMessages.length > 1 ? "s" : ""}</span>
      <button class="oe-close" onclick={onClose} aria-label="Close">✕</button>
    </header>
    {#each openMessages as m (m.summary.id)}
      <MessageBlock
        summary={m.summary}
        body={m.body}
        expanded={isExpanded(m.summary.id)}
        {renderDeps}
        onToggle={() => (expandedId = expandedId === m.summary.id ? null : m.summary.id)}
        onDownload={(att) => onDownload(m.summary.id, att)}
      />
    {/each}
  {/if}
</section>
