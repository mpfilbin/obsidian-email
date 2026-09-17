<script lang="ts">
  import type { ViewModel, ViewState } from "./view-model";
  import { icon } from "./icon-action";
  import AccountSwitcher from "./components/AccountSwitcher.svelte";
  import MailboxList from "./components/MailboxList.svelte";
  import MessageList from "./components/MessageList.svelte";
  import ReadingPane from "./components/ReadingPane.svelte";
  import SearchBar from "./components/SearchBar.svelte";
  import Resizer from "./components/Resizer.svelte";
  import { clampPaneWidths, loadPaneWidths, savePaneWidths, type PaneWidths } from "./pane-layout";
  import { showSyncingToast } from "./refresh-toast";
  import type { Mailbox } from "../providers/types";

  let { vm, onAddAccount, onThreadContextMenu, onMailboxContextMenu }: {
    vm: ViewModel;
    onAddAccount: () => void;
    /** Shows the host's native context menu (built in main.ts, since it
     *  needs Obsidian's real Menu class) with a "Move" command; `onMove`
     *  is called back with whichever folder the user picks. */
    onThreadContextMenu: (evt: MouseEvent, candidates: Mailbox[], onMove: (destinationMailboxId: string) => void) => void;
    /** Shows the host's native context menu with "Rename" and "Delete"
     *  commands; `onRename`/`onDelete` are called back if confirmed. */
    onMailboxContextMenu: (
      evt: MouseEvent,
      currentName: string,
      onRename: (newName: string) => void,
      onDelete: () => void,
    ) => void;
  } = $props();

  // `vm` is a stable prop for the life of the view; reading it here to seed
  // the initial snapshot is intentional.
  // svelte-ignore state_referenced_locally
  let state = $state<ViewState>(vm.getState());
  $effect(() => vm.subscribe((s) => { state = s; }));

  const activeSyncing = $derived(
    state.accounts.find((a) => a.id === state.activeAccountId)?.status === "syncing",
  );
  // Any account syncing — manual refresh or background poll alike — gets the
  // same toast; replaces the old refresh-button spin and account-icon ring.
  const anySyncing = $derived(state.accounts.some((a) => a.status === "syncing"));
  $effect(() => {
    if (!anySyncing) return;
    const toast = showSyncingToast();
    return () => toast.hide();
  });

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
  //
  // Search is the exception to "not Trash ⇒ recoverable": `runSearch` fills the
  // list from a mailbox-wide Graph search that spans every folder, Deleted
  // Items included, without touching `activeMailboxId` — so a hit shown while
  // the active mailbox is Inbox may still be sitting in Trash, where the very
  // same call is permanent. The design deliberately never asks Graph where an
  // individual message lives, so the only safe default is to confirm every
  // delete while a search is showing. `isTrashMailbox` keeps its original
  // meaning (the active mailbox's kind); this is a second, independent trigger.
  function requestDelete(label: string, run: () => void): void {
    if (pendingSwitch) return; // one prompt at a time — don't queue a delete-confirm behind an active switch prompt
    if (isTrashMailbox || state.search.active) pendingDelete = { label, run };
    else run();
  }
  function confirmDelete(): void {
    const p = pendingDelete;
    pendingDelete = null;
    p?.run();
  }

  // Deleting a folder is always irreversible — Graph has no soft-delete /
  // Trash equivalent for folders the way it does for messages — so this
  // confirms unconditionally, unlike requestDelete's Trash/search-only gate.
  function requestDeleteMailbox(run: () => void): void {
    if (pendingSwitch) return;
    pendingDelete = { label: "folder", run };
  }
  function cancelDelete(): void {
    pendingDelete = null;
  }

  // Archive/Delete on a row are navigation-like: when the acted-on message or
  // thread is the open one, the ViewModel calls `closeThread()`, which drops
  // the composer along with the reading pane (see its doc comment) — so they
  // have to pass through the same save/discard prompt as every other
  // navigation. They also inherit requestDelete's "one prompt at a time" rule:
  // a click landing while a switch prompt is already up is ignored rather than
  // replacing the navigation the user is being asked about.
  function requestRowAction(run: () => void): void {
    if (pendingSwitch) return;
    requestSwitch(run);
  }

  // Archiving/deleting the currently open thread or message makes the
  // ViewModel call closeThread() internally — collapse the reading pane too
  // in that case, exactly as if the floating close button had been clicked,
  // rather than leaving it open-but-empty. Checked against `state` before
  // the (async) provider call runs, since closeThread() only fires after
  // that call resolves.
  const closesOpenThread = (threadId: string): boolean => threadId === state.openThreadId;
  const closesOpenMessage = (messageId: string): boolean =>
    state.openMessages.some((m) => m.summary.id === messageId);

  // Shared by drag-and-drop (MailboxList's onDropThread) and the row context
  // menu's "Move" command — same guards as archive/delete: the unsaved-
  // composer prompt via requestRowAction, and collapsing the reading pane if
  // the moved thread was the open one.
  function moveThread(threadId: string, destinationMailboxId: string): void {
    requestRowAction(() => {
      const closes = closesOpenThread(threadId);
      vm.moveThread(threadId, destinationMailboxId);
      if (closes) setReadingPaneCollapsed(true);
    });
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

  // Both column tracks below are expressed as plain lengths (px/calc), never
  // `fr`/`minmax()`, specifically so the browser can smoothly interpolate
  // grid-template-columns between the collapsed and expanded layouts — mixing
  // track-sizing function types (e.g. minmax() vs a bare length) isn't
  // reliably animatable. `widths.messageList` is untouched while collapsed,
  // so re-expanding always lands back on the last resize-handle width.
  let animateGridColumns = $state(false);
  let animateGridColumnsTimer: ReturnType<typeof setTimeout> | undefined;
  function setReadingPaneCollapsed(collapsed: boolean): void {
    if (collapsed === readingPaneCollapsed) return;
    clearTimeout(animateGridColumnsTimer);
    animateGridColumns = true;
    readingPaneCollapsed = collapsed;
    // Only the explicit collapse/expand transition animates; a resize drag
    // updates `widths` continuously and must track the pointer immediately.
    animateGridColumnsTimer = setTimeout(() => { animateGridColumns = false; }, 250);
  }

  const gridColumns = $derived.by(() => {
    const beforeMessageList = 56 + widths.mailboxes + 6;
    if (readingPaneCollapsed) return `56px ${widths.mailboxes}px 6px calc(100% - ${beforeMessageList + 6}px) 0px 0px`;
    const beforeReadingPane = beforeMessageList + widths.messageList + 6 + 6;
    return `56px ${widths.mailboxes}px 6px ${widths.messageList}px 6px calc(100% - ${beforeReadingPane}px)`;
  });
  const gridStyle = $derived(
    `grid-template-columns: ${gridColumns};` +
      (animateGridColumns ? " transition: grid-template-columns 220ms ease;" : ""),
  );
</script>

<div class="obsidian-email-view oe-grid" style={gridStyle}>
  <AccountSwitcher
    accounts={state.accounts}
    activeId={state.activeAccountId}
    onSelect={(id) => requestSwitch(() => vm.selectAccount(id))}
    {onAddAccount}
  />
  <section class="oe-mailbox-col">
    <button type="button" class="oe-new-message-full" onclick={() => requestSwitch(() => vm.openNewMessage())}>
      <span class="oe-action-icon" use:icon={"pencil"}></span>New message
    </button>
    <MailboxList
      mailboxes={state.mailboxes}
      activeId={state.activeMailboxId}
      onSelect={(id) => requestSwitch(() => vm.selectMailbox(id))}
      onDropThread={(threadId, destinationId) => moveThread(threadId, destinationId)}
      onContextMenu={(evt, id) => {
        const box = state.mailboxes.find((m) => m.id === id);
        if (!box) return;
        onMailboxContextMenu(
          evt,
          box.name,
          (newName) => vm.renameMailbox(id, newName),
          () => requestRowAction(() => requestDeleteMailbox(() => { void vm.deleteMailbox(id); })),
        );
      }}
    />
    <button type="button" class="oe-new-folder" onclick={() => vm.requestCreateMailbox()}>
      <span class="oe-action-icon" use:icon={"folder-plus"}></span>New folder
    </button>
  </section>
  <Resizer label="Resize mailbox list" onDrag={resizeMailboxes} />
  <section class="oe-list-col">
    <SearchBar
      query={state.search.query}
      active={state.search.active}
      syncing={activeSyncing}
      onSearch={(q) => vm.runSearch(q)}
      onClear={() => vm.clearSearch()}
      onRefresh={() => vm.refresh()}
    />
    {#if state.notice}
      <div class="oe-notice">{state.notice}</div>
    {/if}
    <MessageList
      threads={state.threads}
      openThreadId={state.openThreadId}
      hasMore={state.hasMore}
      loading={state.loadingList}
      onOpen={(id) => requestSwitch(() => { vm.openThread(id); setReadingPaneCollapsed(false); })}
      onLoadMore={() => vm.loadMore()}
      {isDraftsMailbox}
      {isArchiveMailbox}
      {isTrashMailbox}
      onArchiveThread={(id) => requestRowAction(() => { const closes = closesOpenThread(id); vm.archiveThread(id); if (closes) setReadingPaneCollapsed(true); })}
      onDeleteThread={(id) => requestRowAction(() => requestDelete("thread", () => { const closes = closesOpenThread(id); vm.deleteThread(id); if (closes) setReadingPaneCollapsed(true); }))}
      onThreadContextMenu={(evt, id) =>
        onThreadContextMenu(
          evt,
          state.mailboxes.filter((m) => m.id !== state.activeMailboxId),
          (destinationId) => moveThread(id, destinationId),
        )}
    />
  </section>
  <Resizer label="Resize reading pane" onDrag={resizeMessageList} />
  <ReadingPane
    openMessages={state.openMessages}
    autoLoadImages={state.autoLoadImages}
    renderDeps={vm.renderDeps()}
    onClose={() => requestSwitch(() => vm.closeThread())}
    onCollapse={() => requestSwitch(() => { vm.closeThread(); setReadingPaneCollapsed(true); })}
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
    onArchiveMessage={(id) => requestRowAction(() => { const closes = closesOpenMessage(id); vm.archiveMessage(id); if (closes) setReadingPaneCollapsed(true); })}
    onDeleteMessage={(id) => requestRowAction(() => requestDelete("message", () => { const closes = closesOpenMessage(id); vm.deleteMessage(id); if (closes) setReadingPaneCollapsed(true); }))}
    onSaveToVault={(id) => vm.saveMessageToVault(id)}
  />
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
