<script lang="ts">
  import type { ContactsStatus } from "../../sync/contact-sync";
  import { icon } from "../icon-action";

  let { count, status, onGrant }: { count: number; status: ContactsStatus; onGrant: () => void } = $props();

  // Both need the same fix: run the OAuth flow again with the Contacts scope.
  const blocked = $derived(status === "needs-consent" || status === "needs-reauth");
</script>

<nav class="oe-mailboxes">
  <button type="button" class="oe-mailbox is-active">
    <span class="oe-mailbox-icon" use:icon={"contact"}></span>
    <span class="oe-mailbox-name">All contacts</span>
    {#if count}<span class="oe-count">{count}</span>{/if}
  </button>
  {#if blocked}
    <div class="oe-contacts-consent">
      <p>Contacts access hasn't been granted for this account.</p>
      <button type="button" class="oe-grant-contacts" onclick={onGrant}>Grant contacts access</button>
    </div>
  {:else if status === "error"}
    <p class="oe-empty">Couldn't load contacts.</p>
  {/if}
</nav>
