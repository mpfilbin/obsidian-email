<script lang="ts">
  import type { Mailbox } from "../../providers/types";
  import { icon } from "../icon-action";
  import { mailboxIcon } from "../mailbox-icons";

  let { mailboxes, activeId, onSelect }: {
    mailboxes: Mailbox[];
    activeId: string | null;
    onSelect: (id: string) => void;
  } = $props();
</script>

<nav class="oe-mailboxes">
  {#each mailboxes as mb (mb.id)}
    <button class="oe-mailbox" class:is-active={mb.id === activeId} onclick={() => onSelect(mb.id)}>
      <span class="oe-mailbox-icon" use:icon={mailboxIcon(mb.kind)}></span>
      <span class="oe-mailbox-name">{mb.name}</span>
      {#if mb.unreadCount}<span class="oe-count">{mb.unreadCount}</span>{/if}
    </button>
  {/each}
</nav>
