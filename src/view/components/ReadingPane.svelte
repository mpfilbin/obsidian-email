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
    /** The message an inline (reply/forward) composer is answering — with the
     *  mode, this identifies the composer, so a new one starts fresh. */
    activeComposerMessageId?: string | null;
    composerMode?: "reply" | "replyAll" | "forward" | "new" | "editDraft" | null;
    composerProps?: ComposerFieldProps | null;
  } = $props();

  const lastId = $derived(openMessages.at(-1)?.summary.id ?? null);
  // `openMessages` stays oldest → newest (that order drives the default
  // expansion, the subject line and the thread identity); only the display is
  // flipped so the most recent message sits at the top.
  const displayMessages = $derived([...openMessages].reverse());
  const isExpanded = (id: string) => (targetMessageId === undefined ? lastId : targetMessageId) === id;

  // Reply / Reply all / Forward compose at the TOP of the thread, so there is
  // no scrolling past a long message to reach the editor. (New message and
  // Edit draft take over the whole pane instead — see the template.)
  const inlineMode = $derived(
    composerMode === "reply" || composerMode === "replyAll" || composerMode === "forward" ? composerMode : null,
  );
  const composerKey = $derived(inlineMode && composerProps ? `${inlineMode}:${activeComposerMessageId ?? ""}` : null);

  // Bring a freshly opened inline composer into view. Keyed on the composer's
  // identity (a string), not `composerProps` — that object is rebuilt on every
  // keystroke, which would snap the pane back to the top while typing.
  let scrollEl = $state<HTMLDivElement | null>(null);
  $effect(() => {
    if (composerKey !== null && scrollEl) scrollEl.scrollTop = 0;
  });
</script>

<section class="oe-reading-pane">
  {#if composerMode === "new" || composerMode === "editDraft"}
    {#if composerProps}<Composer mode={composerMode} {...composerProps} />{/if}
  {:else if openMessages.length === 0}
    <p class="oe-empty">Select a message to read</p>
  {:else}
    <div class="oe-reading-scroll" bind:this={scrollEl}>
      {#if inlineMode && composerProps}
        {#key composerKey}
          <div class="oe-reply-composer">
            <Composer mode={inlineMode} {...composerProps} />
          </div>
        {/key}
      {/if}
      <header class="oe-reading-head">
        <h3>{openMessages.at(-1)?.summary.subject}</h3>
        <span>{openMessages.length} message{openMessages.length > 1 ? "s" : ""}</span>
        <button class="oe-close" onclick={onClose} aria-label="Close">✕</button>
      </header>
      {#each displayMessages as m (m.summary.id)}
        <MessageBlock
          summary={m.summary}
          body={m.body}
          expanded={isExpanded(m.summary.id)}
          {autoLoadImages}
          {renderDeps}
          onToggle={() => onToggleExpand?.(m.summary.id)}
          onDownload={(att) => onDownload(m.summary.id, att)}
        />
      {/each}
    </div>
  {/if}
</section>
