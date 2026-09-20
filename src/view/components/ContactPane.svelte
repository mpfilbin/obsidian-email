<script lang="ts">
  import type { Contact, ContactDraft } from "../../providers/types";
  import type { ContactEditState } from "../view-model";
  import ContactDetail from "./ContactDetail.svelte";
  import ContactForm from "./ContactForm.svelte";

  let { contact, edit, onEmail, onEdit, onDelete, onChange, onSave, onCancel }: {
    contact: Contact | null;
    edit: ContactEditState | null;
    onEmail: (email: string) => void;
    onEdit: () => void;
    onDelete: () => void;
    onChange: (patch: Partial<ContactDraft>) => void;
    onSave: () => void;
    onCancel: () => void;
  } = $props();
</script>

<section class="oe-reading-pane">
  <div class="oe-reading-scroll">
    {#if edit}
      <!-- Remount per form so the text mirrors re-seed. Keyed on `seq`, not
           mode+contactId: those are identical for two consecutive New forms. -->
      {#key edit.seq}
        <ContactForm {edit} {onChange} {onSave} {onCancel} />
      {/key}
    {:else if contact}
      <ContactDetail {contact} {onEmail} {onEdit} {onDelete} />
    {:else}
      <p class="oe-empty">Select a contact</p>
    {/if}
  </div>
</section>
