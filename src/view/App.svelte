<script lang="ts">
  import type { ViewModel, ViewState } from "./view-model";
  import AccountSwitcher from "./components/AccountSwitcher.svelte";
  import MailboxList from "./components/MailboxList.svelte";
  import MessageList from "./components/MessageList.svelte";
  import ReadingPane from "./components/ReadingPane.svelte";
  import SearchBar from "./components/SearchBar.svelte";

  let { vm, onAddAccount }: { vm: ViewModel; onAddAccount: () => void } = $props();

  // `vm` is a stable prop for the life of the view; reading it here to seed
  // the initial snapshot is intentional.
  // svelte-ignore state_referenced_locally
  let state = $state<ViewState>(vm.getState());
  $effect(() => vm.subscribe((s) => { state = s; }));
</script>

<div class="obsidian-email-view oe-grid">
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
  <section class="oe-list-col">
    <SearchBar
      query={state.search.query}
      active={state.search.active}
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
      onOpen={(id) => vm.openThread(id)}
      onLoadMore={() => vm.loadMore()}
    />
  </section>
  <ReadingPane
    openMessages={state.openMessages}
    onClose={() => vm.closeThread()}
  />
</div>
