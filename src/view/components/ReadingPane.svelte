<script lang="ts">
  import type { AttachmentMeta } from "../../providers/types";
  import type { ComposerFieldProps } from "../composer-props";
  import type { ViewState } from "../view-model";
  import Composer from "./Composer.svelte";
  import MessageBlock from "./MessageBlock.svelte";

  let { openMessages, autoLoadImages, renderDeps, onClose, onDownload, isDraftsMailbox, isArchiveMailbox, isTrashMailbox, activeComposerMessageId, composerMode, composerProps, onOpenReply, onOpenForward, onEditDraft, onArchiveMessage, onDeleteMessage }: {
    openMessages: ViewState["openMessages"];
    /** `prefs.autoLoadImages` — when true, remote content renders immediately. */
    autoLoadImages: boolean;
    renderDeps: { getInlineAttachment: (cid: string) => Promise<Blob | undefined>; openExternal: (url: string) => void };
    onClose: () => void;
    onDownload: (messageId: string, att: AttachmentMeta) => void;
    isDraftsMailbox: boolean;
    isArchiveMailbox: boolean;
    isTrashMailbox: boolean;
    activeComposerMessageId: string | null;
    composerMode: "reply" | "replyAll" | "forward" | "new" | "editDraft" | null;
    composerProps: ComposerFieldProps | null;
    onOpenReply: (messageId: string, mode: "reply" | "replyAll") => void;
    onOpenForward: (messageId: string) => void;
    onEditDraft: (messageId: string) => void;
    onArchiveMessage: (messageId: string) => void;
    onDeleteMessage: (messageId: string) => void;
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
  {#if composerMode === "new" || composerMode === "editDraft"}
    {#if composerProps}<Composer mode={composerMode} {...composerProps} />{/if}
  {:else if openMessages.length === 0}
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
        {autoLoadImages}
        {renderDeps}
        onToggle={() => (expandedId = expandedId === m.summary.id ? null : m.summary.id)}
        onDownload={(att) => onDownload(m.summary.id, att)}
        {isDraftsMailbox}
        {isArchiveMailbox}
        {isTrashMailbox}
        composerMode={activeComposerMessageId === m.summary.id ? composerMode : null}
        composerProps={activeComposerMessageId === m.summary.id ? composerProps : null}
        onOpenReply={(mode) => onOpenReply(m.summary.id, mode)}
        onOpenForward={() => onOpenForward(m.summary.id)}
        onEditDraft={() => onEditDraft(m.summary.id)}
        onArchive={() => onArchiveMessage(m.summary.id)}
        onDelete={() => onDeleteMessage(m.summary.id)}
      />
    {/each}
  {/if}
</section>
