<script lang="ts">
  import type { AttachmentMeta } from "../../providers/types";
  import type { ComposerFieldProps } from "../composer-props";
  import type { ViewState } from "../view-model";
  import Composer from "./Composer.svelte";
  import MessageBlock from "./MessageBlock.svelte";

  let { openMessages, autoLoadImages, renderDeps, onClose, onDownload, targetMessageId, onToggleExpand, activeComposerMessageId, composerMode, composerProps }: {
    openMessages: ViewState["openMessages"];
    /** `prefs.autoLoadImages` — when true, remote content renders immediately. */
    autoLoadImages: boolean;
    renderDeps: { getInlineAttachment: (cid: string) => Promise<Blob | undefined>; openExternal: (url: string) => void };
    onClose: () => void;
    onDownload: (messageId: string, att: AttachmentMeta) => void;
    /** The expanded message (owned by App so the ribbon can act on it).
     *  `undefined` means "not controlled": expand the last message. */
    targetMessageId?: string | null;
    onToggleExpand?: (messageId: string) => void;
    activeComposerMessageId?: string | null;
    composerMode?: "reply" | "replyAll" | "forward" | "new" | "editDraft" | null;
    composerProps?: ComposerFieldProps | null;
  } = $props();

  const lastId = $derived(openMessages.at(-1)?.summary.id ?? null);
  const isExpanded = (id: string) => (targetMessageId === undefined ? lastId : targetMessageId) === id;
</script>

<section class="oe-reading-pane">
  {#if composerMode === "new" || composerMode === "editDraft"}
    {#if composerProps}<Composer mode={composerMode} {...composerProps} />{/if}
  {:else if openMessages.length === 0}
    <p class="oe-empty">Select a message to read</p>
  {:else}
    <div class="oe-reading-scroll">
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
          {autoLoadImages}
          {renderDeps}
          onToggle={() => onToggleExpand?.(m.summary.id)}
          onDownload={(att) => onDownload(m.summary.id, att)}
          composerMode={activeComposerMessageId === m.summary.id ? composerMode : null}
          composerProps={activeComposerMessageId === m.summary.id ? composerProps : null}
        />
      {/each}
    </div>
  {/if}
</section>
