<script lang="ts">
  let { query, active, syncing, readingPaneCollapsed, onSearch, onClear, onRefresh, onToggleReadingPane, onNewMessage }: {
    query: string;
    active: boolean;
    syncing: boolean;
    readingPaneCollapsed: boolean;
    onSearch: (q: string) => void;
    onClear: () => void;
    onRefresh: () => void;
    onToggleReadingPane: () => void;
    onNewMessage: () => void;
  } = $props();

  // Seed the local editable value from the initial prop; the $effect below
  // keeps it synced when `query` changes (e.g. after clearing a search).
  // svelte-ignore state_referenced_locally
  let value = $state(query);
  $effect(() => { value = query; });
</script>

<form class="oe-search" onsubmit={(e) => { e.preventDefault(); if (value.trim()) onSearch(value.trim()); }}>
  <input type="search" placeholder="Search mail…" bind:value />
  <button type="submit">Search</button>
  <button
    type="button"
    class="oe-refresh"
    class:is-syncing={syncing}
    onclick={onRefresh}
    aria-label={syncing ? "Syncing" : "Refresh"}
    title={syncing ? "Syncing…" : "Refresh"}
  >⟳</button>
  <button
    type="button"
    class="oe-toggle-reading"
    onclick={onToggleReadingPane}
    aria-label={readingPaneCollapsed ? "Show reading pane" : "Hide reading pane"}
    title={readingPaneCollapsed ? "Show reading pane" : "Hide reading pane"}
  >{readingPaneCollapsed ? "☐" : "▣"}</button>
  <button type="button" class="oe-new-message" onclick={onNewMessage} title="New message" aria-label="New message">✎</button>
  {#if active}
    <button type="button" class="oe-search-pill" onclick={onClear}>Search: {query} ✕</button>
  {/if}
</form>
