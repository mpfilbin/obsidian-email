<script lang="ts">
  import type { ViewModel, ViewState } from "./view-model";
  import AccountSwitcher from "./components/AccountSwitcher.svelte";
  import MailboxList from "./components/MailboxList.svelte";
  import MessageList from "./components/MessageList.svelte";
  import ReadingPane from "./components/ReadingPane.svelte";
  import SearchBar from "./components/SearchBar.svelte";
  import Resizer from "./components/Resizer.svelte";
  import { clampPaneWidths, loadPaneWidths, savePaneWidths, type PaneWidths } from "./pane-layout";

  let { vm, onAddAccount }: { vm: ViewModel; onAddAccount: () => void } = $props();

  // `vm` is a stable prop for the life of the view; reading it here to seed
  // the initial snapshot is intentional.
  // svelte-ignore state_referenced_locally
  let state = $state<ViewState>(vm.getState());
  $effect(() => vm.subscribe((s) => { state = s; }));

  const activeSyncing = $derived(
    state.accounts.find((a) => a.id === state.activeAccountId)?.status === "syncing",
  );

  const isDraftsMailbox = $derived(
    state.mailboxes.find((m) => m.id === state.activeMailboxId)?.kind === "drafts",
  );
  const isArchiveMailbox = $derived(
    state.mailboxes.find((m) => m.id === state.activeMailboxId)?.kind === "archive",
  );
  const isTrashMailbox = $derived(
    state.mailboxes.find((m) => m.id === state.activeMailboxId)?.kind === "trash",
  );

  let pendingSwitch = $state<(() => void) | null>(null);

  // Guards every action that would replace or hide the open composer: the
  // compose actions themselves, and the navigations (account/mailbox/thread)
  // that make the ViewModel drop it. Without the guard those navigations would
  // silently discard unsaved content.
  function requestSwitch(open: () => void): void {
    // Any navigation invalidates a previously-queued delete confirmation —
    // the user's context is changing either way, whether this switch fires
    // immediately or queues its own prompt — so it must not resurface once
    // this (or a subsequent) prompt resolves. Mirrors the guard in
    // requestDelete that stops a delete-confirm from queuing behind an
    // active switch prompt.
    pendingDelete = null;
    if (vm.hasUnsavedComposerContent()) pendingSwitch = open;
    else open();
  }

  async function resolvePromptSave(): Promise<void> {
    if (state.composer?.mode === "new" || state.composer?.mode === "editDraft") {
      await vm.saveDraft();
      // saveDraft reports failure through composer.error instead of throwing,
      // so a failed save is otherwise indistinguishable from a successful one.
      // Switching anyway would replace the composer wholesale, taking the
      // unsaved text and the error explaining the failure with it — so leave
      // the prompt and the composer up for a retry or an explicit discard.
      if (vm.getState().composer?.error != null) return;
    } else {
      await vm.discardDraft();
    }
    const next = pendingSwitch;
    pendingSwitch = null;
    next?.();
  }
  async function resolvePromptDiscard(): Promise<void> {
    await vm.discardDraft();
    const next = pendingSwitch;
    pendingSwitch = null;
    next?.();
  }
  function resolvePromptCancel(): void {
    pendingSwitch = null;
  }

  let pendingDelete = $state<{ label: string; run: () => void } | null>(null);

  // Delete is the only action that's ever irreversible (permanently deleting
  // from Trash — see MailProvider.deleteMessage's doc comment). Everywhere
  // else it's recoverable (Graph moves the message to Deleted Items), so it
  // fires immediately with no prompt.
  function requestDelete(label: string, run: () => void): void {
    if (pendingSwitch) return; // one prompt at a time — don't queue a delete-confirm behind an active switch prompt
    if (isTrashMailbox) pendingDelete = { label, run };
    else run();
  }
  function confirmDelete(): void {
    const p = pendingDelete;
    pendingDelete = null;
    p?.run();
  }
  function cancelDelete(): void {
    pendingDelete = null;
  }

  const composerFieldProps = $derived(state.composer ? {
    to: state.composer.to, cc: state.composer.cc, bcc: state.composer.bcc,
    subject: state.composer.subject, bodyHtml: state.composer.bodyHtml,
    sending: state.composer.sending, error: state.composer.error,
    onFieldsChange: (patch: Parameters<typeof vm.updateComposerFields>[0]) => vm.updateComposerFields(patch),
    onBodyChange: (html: string) => vm.updateComposerBody(html),
    onSend: () => vm.send(),
    onSaveDraft: () => vm.saveDraft(),
    onDiscard: () => vm.discardDraft(),
  } : null);

  // Column widths and the reading-pane collapse are view-only chrome (not
  // synced data), remembered per-device via localStorage as a convenience.
  // svelte-ignore state_referenced_locally
  let widths = $state<PaneWidths>(loadPaneWidths());
  let readingPaneCollapsed = $state(false);

  function resizeMailboxes(dx: number): void {
    widths = clampPaneWidths({ ...widths, mailboxes: widths.mailboxes + dx });
    savePaneWidths(widths);
  }
  function resizeMessageList(dx: number): void {
    widths = clampPaneWidths({ ...widths, messageList: widths.messageList + dx });
    savePaneWidths(widths);
  }

  const gridColumns = $derived(
    `56px ${widths.mailboxes}px 6px ${widths.messageList}px ` +
      (readingPaneCollapsed ? "0px 0px" : "6px minmax(200px, 1fr)"),
  );
</script>

<div class="obsidian-email-view oe-grid" style={`grid-template-columns: ${gridColumns};`}>
  <AccountSwitcher
    accounts={state.accounts}
    activeId={state.activeAccountId}
    onSelect={(id) => requestSwitch(() => vm.selectAccount(id))}
    {onAddAccount}
  />
  <MailboxList
    mailboxes={state.mailboxes}
    activeId={state.activeMailboxId}
    onSelect={(id) => requestSwitch(() => vm.selectMailbox(id))}
  />
  <Resizer label="Resize mailbox list" onDrag={resizeMailboxes} />
  <section class="oe-list-col">
    <SearchBar
      query={state.search.query}
      active={state.search.active}
      syncing={activeSyncing}
      {readingPaneCollapsed}
      onSearch={(q) => vm.runSearch(q)}
      onClear={() => vm.clearSearch()}
      onRefresh={() => vm.refresh()}
      onToggleReadingPane={() => (readingPaneCollapsed = !readingPaneCollapsed)}
      onNewMessage={() => requestSwitch(() => vm.openNewMessage())}
    />
    {#if state.notice}
      <div class="oe-notice">{state.notice}</div>
    {/if}
    <MessageList
      threads={state.threads}
      openThreadId={state.openThreadId}
      hasMore={state.hasMore}
      loading={state.loadingList}
      onOpen={(id) => requestSwitch(() => vm.openThread(id))}
      onLoadMore={() => vm.loadMore()}
      {isDraftsMailbox}
      {isArchiveMailbox}
      {isTrashMailbox}
      onArchiveThread={(id) => vm.archiveThread(id)}
      onDeleteThread={(id) => requestDelete("thread", () => vm.deleteThread(id))}
    />
  </section>
  {#if !readingPaneCollapsed}
    <Resizer label="Resize reading pane" onDrag={resizeMessageList} />
    <ReadingPane
      openMessages={state.openMessages}
      autoLoadImages={state.autoLoadImages}
      renderDeps={vm.renderDeps()}
      onClose={() => requestSwitch(() => vm.closeThread())}
      onDownload={(id, att) => vm.downloadAttachmentToDisk(id, att)}
      {isDraftsMailbox}
      {isArchiveMailbox}
      {isTrashMailbox}
      activeComposerMessageId={state.composer?.targetMessageId ?? null}
      composerMode={state.composer?.mode ?? null}
      composerProps={composerFieldProps}
      onOpenReply={(id, mode) => requestSwitch(() => vm.openReply(id, mode))}
      onOpenForward={(id) => requestSwitch(() => vm.openForward(id))}
      onEditDraft={(id) => requestSwitch(() => vm.openDraftForEdit(id))}
      onArchiveMessage={(id) => vm.archiveMessage(id)}
      onDeleteMessage={(id) => requestDelete("message", () => vm.deleteMessage(id))}
    />
  {/if}
  {#if pendingSwitch}
    <div class="oe-composer-prompt">
      <p>You have an unsent message. Save it as a draft before switching?</p>
      {#if state.composer?.mode === "new" || state.composer?.mode === "editDraft"}
        <button type="button" class="oe-composer-prompt-save" onclick={resolvePromptSave}>Save draft</button>
      {/if}
      <button type="button" class="oe-composer-prompt-discard" onclick={resolvePromptDiscard}>Discard</button>
      <button type="button" class="oe-composer-prompt-cancel" onclick={resolvePromptCancel}>Cancel</button>
    </div>
  {:else if pendingDelete}
    <div class="oe-composer-prompt">
      <p>Permanently delete this {pendingDelete.label}? This can't be undone.</p>
      <button type="button" class="oe-delete-confirm" onclick={confirmDelete}>Delete</button>
      <button type="button" class="oe-delete-cancel" onclick={cancelDelete}>Cancel</button>
    </div>
  {/if}
</div>
