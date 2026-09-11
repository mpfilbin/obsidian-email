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
    onSelect={(id) => vm.selectAccount(id)}
    {onAddAccount}
  />
  <MailboxList
    mailboxes={state.mailboxes}
    activeId={state.activeMailboxId}
    onSelect={(id) => vm.selectMailbox(id)}
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
    />
    {#if state.notice}
      <div class="oe-notice">{state.notice}</div>
    {/if}
    <MessageList
      threads={state.threads}
      openThreadId={state.openThreadId}
      hasMore={state.hasMore}
      loading={state.loadingList}
      onOpen={(id) => vm.openThread(id)}
      onLoadMore={() => vm.loadMore()}
    />
  </section>
  {#if !readingPaneCollapsed}
    <Resizer label="Resize reading pane" onDrag={resizeMessageList} />
    <ReadingPane
      openMessages={state.openMessages}
      autoLoadImages={state.autoLoadImages}
      renderDeps={vm.renderDeps()}
      onClose={() => vm.closeThread()}
      onDownload={(id, att) => vm.downloadAttachmentToDisk(id, att)}
    />
  {/if}
</div>
