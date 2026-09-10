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
  export function set(m: ViewState["openMessages"]): void { messages = m; }
</script>

<ReadingPane openMessages={messages} {autoLoadImages} {renderDeps} {onClose} {onDownload} />
