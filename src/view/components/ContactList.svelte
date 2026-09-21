<script lang="ts">
  import type { Contact } from "../../providers/types";
  import { primaryEmail } from "../contact-draft";

  let { contacts, selectedId, search, hasAny, loading, onSearch, onSelect }: {
    contacts: Contact[];
    selectedId: string | null;
    search: string;
    /** Whether the account has any contacts at all (before search filtering). */
    hasAny: boolean;
    loading: boolean;
    onSearch: (query: string) => void;
    onSelect: (id: string) => void;
  } = $props();
</script>

<div class="oe-search">
  <input
    type="search" data-field="contact-search" placeholder="Search contacts…" value={search}
    oninput={(e) => onSearch(e.currentTarget.value)}
  />
</div>
<div class="oe-message-list">
  {#if contacts.length === 0 && !loading}
    <p class="oe-empty">{hasAny ? "No matching contacts" : "No contacts"}</p>
  {/if}
  {#each contacts as c (c.id)}
    <button type="button" class="oe-contact-row" class:is-active={c.id === selectedId} onclick={() => onSelect(c.id)}>
      <span class="oe-contact-name">{c.displayName}</span>
      {#if primaryEmail(c)}<span class="oe-contact-email-line">{primaryEmail(c)}</span>{/if}
    </button>
  {/each}
  {#if loading}<p class="oe-loading">Loading…</p>{/if}
</div>
