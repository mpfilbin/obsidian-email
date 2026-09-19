<script lang="ts">
  let { query, onSearch, onClose }: {
    query: string;
    onSearch: (q: string) => void;
    /** Dismisses the field (the ✕ button and Escape). */
    onClose: () => void;
  } = $props();

  // Seed the local editable value from the initial prop; the $effect below
  // keeps it synced when `query` changes (e.g. after clearing a search).
  // svelte-ignore state_referenced_locally
  let value = $state(query);
  $effect(() => { value = query; });

  // The field only exists while the user has asked for it, so it takes focus
  // as soon as it appears.
  let input = $state<HTMLInputElement | null>(null);
  $effect(() => { input?.focus(); });
</script>

<form class="oe-search" onsubmit={(e) => { e.preventDefault(); if (value.trim()) onSearch(value.trim()); }}>
  <input
    type="search" placeholder="Search mail…" bind:value bind:this={input}
    onkeydown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
  />
  <button type="button" class="oe-search-close" aria-label="Close search" title="Close search" onclick={onClose}>✕</button>
</form>
