<script lang="ts">
  let { query, active, syncing, onSearch, onClear, onRefresh }: {
    query: string;
    active: boolean;
    syncing: boolean;
    onSearch: (q: string) => void;
    onClear: () => void;
    onRefresh: () => void;
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
  {#if active}
    <button type="button" class="oe-search-pill" onclick={onClear}>Search: {query} ✕</button>
  {/if}
</form>
