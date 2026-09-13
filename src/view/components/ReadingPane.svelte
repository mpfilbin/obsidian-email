<script lang="ts">
  import type { AttachmentMeta } from "../../providers/types";
  import { ACTION_ICON } from "../action-icons";
  import type { ComposerFieldProps } from "../composer-props";
  import { icon } from "../icon-action";
  import type { ViewState } from "../view-model";
  import Composer from "./Composer.svelte";
  import MessageBlock from "./MessageBlock.svelte";

  let { openMessages, autoLoadImages, renderDeps, onClose, onCollapse, onDownload, isDraftsMailbox, isArchiveMailbox, isTrashMailbox, activeComposerMessageId, composerMode, composerProps, onOpenReply, onOpenForward, onEditDraft, onArchiveMessage, onDeleteMessage, onSaveToVault }: {
    openMessages: ViewState["openMessages"];
    /** `prefs.autoLoadImages` — when true, remote content renders immediately. */
    autoLoadImages: boolean;
    renderDeps: { getInlineAttachment: (cid: string) => Promise<Blob | undefined>; openExternal: (url: string) => void };
    onClose: () => void;
    /** Closes the thread AND collapses the reading pane's grid column, letting
     *  the message list expand to fill the freed width. Distinct from
     *  `onClose` (the subject header's ✕), which only closes the thread. */
    onCollapse: () => void;
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
    onSaveToVault: (messageId: string) => void;
  } = $props();

  let expandedId = $state<string | null>(null);
  const lastId = $derived(openMessages.at(-1)?.summary.id ?? null);
  const isExpanded = (id: string) => (expandedId ?? lastId) === id;
  const expandedMessage = $derived(openMessages.find((m) => isExpanded(m.summary.id)) ?? null);

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
    {#if expandedMessage}
      <div class="oe-reading-actions">
        {#if isDraftsMailbox}
          <button type="button" data-action="edit-draft" onclick={() => onEditDraft(expandedMessage.summary.id)}>
            <span class="oe-action-icon" use:icon={ACTION_ICON.editDraft}></span>Edit
          </button>
          <button type="button" data-action="save-to-vault" onclick={() => onSaveToVault(expandedMessage.summary.id)}>
            <span class="oe-action-icon" use:icon={ACTION_ICON.saveToVault}></span>Save to vault
          </button>
          <button type="button" data-action="delete" onclick={() => onDeleteMessage(expandedMessage.summary.id)}>
            <span class="oe-action-icon" use:icon={ACTION_ICON.delete}></span>Delete
          </button>
        {:else if isTrashMailbox}
          <button type="button" data-action="save-to-vault" onclick={() => onSaveToVault(expandedMessage.summary.id)}>
            <span class="oe-action-icon" use:icon={ACTION_ICON.saveToVault}></span>Save to vault
          </button>
          <button type="button" data-action="delete" onclick={() => onDeleteMessage(expandedMessage.summary.id)}>
            <span class="oe-action-icon" use:icon={ACTION_ICON.delete}></span>Delete
          </button>
        {:else}
          <button type="button" data-action="reply" onclick={() => onOpenReply(expandedMessage.summary.id, "reply")}>
            <span class="oe-action-icon" use:icon={ACTION_ICON.reply}></span>Reply
          </button>
          <button type="button" data-action="reply-all" onclick={() => onOpenReply(expandedMessage.summary.id, "replyAll")}>
            <span class="oe-action-icon" use:icon={ACTION_ICON.replyAll}></span>Reply all
          </button>
          <button type="button" data-action="forward" onclick={() => onOpenForward(expandedMessage.summary.id)}>
            <span class="oe-action-icon" use:icon={ACTION_ICON.forward}></span>Forward
          </button>
          {#if !isArchiveMailbox}
            <button type="button" data-action="archive" onclick={() => onArchiveMessage(expandedMessage.summary.id)}>
              <span class="oe-action-icon" use:icon={ACTION_ICON.archive}></span>Archive
            </button>
          {/if}
          <button type="button" data-action="save-to-vault" onclick={() => onSaveToVault(expandedMessage.summary.id)}>
            <span class="oe-action-icon" use:icon={ACTION_ICON.saveToVault}></span>Save to vault
          </button>
          <button type="button" data-action="delete" onclick={() => onDeleteMessage(expandedMessage.summary.id)}>
            <span class="oe-action-icon" use:icon={ACTION_ICON.delete}></span>Delete
          </button>
        {/if}
        <button type="button" class="oe-collapse-reading" data-action="collapse" onclick={onCollapse} aria-label="Close reading pane" title="Close reading pane">
          <span class="oe-action-icon" use:icon={ACTION_ICON.collapse}></span>
        </button>
      </div>
    {/if}
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
          onToggle={() => (expandedId = expandedId === m.summary.id ? null : m.summary.id)}
          onDownload={(att) => onDownload(m.summary.id, att)}
          composerMode={activeComposerMessageId === m.summary.id ? composerMode : null}
          composerProps={activeComposerMessageId === m.summary.id ? composerProps : null}
        />
      {/each}
    </div>
  {/if}
</section>
