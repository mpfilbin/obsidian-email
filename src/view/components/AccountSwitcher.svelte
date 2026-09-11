<script lang="ts">
  import type { ViewState } from "../view-model";

  let { accounts, activeId, onSelect, onAddAccount }: {
    accounts: ViewState["accounts"];
    activeId: string | null;
    onSelect: (id: string) => void;
    onAddAccount: () => void;
  } = $props();

  const initials = (email: string) => email.slice(0, 2).toUpperCase();
</script>

<div class="oe-accounts">
  {#each accounts as a (a.id)}
    <button
      class="oe-account"
      class:is-active={a.id === activeId}
      title={a.email}
      onclick={() => onSelect(a.id)}
    >
      <span class="oe-avatar">{initials(a.email)}</span>
      {#if a.status === "syncing"}<span class="oe-syncing-ring" title="Syncing…" aria-label="Syncing"></span>{/if}
      {#if a.status === "needs-reauth"}<span class="oe-warn" title="Needs re-authentication">!</span>{/if}
    </button>
  {/each}
  <button class="oe-account oe-add" title="Add account" onclick={onAddAccount}>+</button>
</div>
