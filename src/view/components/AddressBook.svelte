<script lang="ts">
  import type { ContactsStatus } from "../../sync/contact-sync";
  import { icon } from "../icon-action";

  let { count, status, onGrant }: {
    count: number;
    status: ContactsStatus;
    /** May return a promise — the button stays disabled until it settles. */
    onGrant: () => void | Promise<void>;
  } = $props();

  // Both need the same fix — run the OAuth flow again (now with the Contacts
  // scope) — but they have different causes, so each gets its own explanation.
  const blocked = $derived(status === "needs-consent" || status === "needs-reauth");
  const reauth = $derived(status === "needs-reauth");

  // Granting opens a browser window; a second click while the first flow is
  // still running would start a second, competing OAuth round-trip.
  let granting = $state(false);
  async function grant(): Promise<void> {
    if (granting) return;
    granting = true;
    try {
      await onGrant();
    } catch {
      // The flow reports its own outcome (App's onGrant resolves with a
      // notice either way); we only care about re-enabling the button.
    } finally {
      granting = false;
    }
  }
</script>

<nav class="oe-mailboxes">
  <button type="button" class="oe-mailbox is-active">
    <span class="oe-mailbox-icon" use:icon={"contact"}></span>
    <span class="oe-mailbox-name">All contacts</span>
    {#if count}<span class="oe-count">{count}</span>{/if}
  </button>
  {#if blocked}
    <div class="oe-contacts-consent">
      <p>
        {reauth
          ? "Signing in to contacts failed for this account."
          : "Contacts access hasn't been granted for this account."}
      </p>
      <button type="button" class="oe-grant-contacts" disabled={granting} onclick={() => void grant()}>
        {reauth ? "Re-authenticate" : "Grant contacts access"}
      </button>
    </div>
  {:else if status === "error"}
    <p class="oe-empty">Couldn't load contacts.</p>
  {/if}
</nav>
