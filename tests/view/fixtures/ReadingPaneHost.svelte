<script lang="ts">
  import type { AttachmentMeta } from "../../../src/providers/types";
  import type { ViewState } from "../../../src/view/view-model";
  import ReadingPane from "../../../src/view/components/ReadingPane.svelte";

  let { initial, autoLoadImages = false, renderDeps, onClose, onDownload }: {
    initial: ViewState["openMessages"];
    autoLoadImages?: boolean;
    renderDeps: { getInlineAttachment: (cid: string) => Promise<Blob | undefined>; openExternal: (url: string) => void };
    onClose: () => void;
    onDownload: (messageId: string, att: AttachmentMeta) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let messages = $state(initial);
  let expandedId = $state<string | null>(null);
  const target = $derived(expandedId ?? messages.at(-1)?.summary.id ?? null);
  // Mirrors App.svelte: expansion resets only when the thread (its first
  // message id) changes, not on per-message body loads within one thread.
  let threadKey: string | null = null;
  $effect(() => {
    const firstId = messages[0]?.summary.id ?? null;
    if (firstId !== threadKey) {
      threadKey = firstId;
      expandedId = null;
    }
  });
  export function set(m: ViewState["openMessages"]): void { messages = m; }
</script>

<ReadingPane
  openMessages={messages} {autoLoadImages} {renderDeps} {onClose} {onDownload}
  targetMessageId={target}
  onToggleExpand={(id) => (expandedId = expandedId === id ? null : id)}
/>
