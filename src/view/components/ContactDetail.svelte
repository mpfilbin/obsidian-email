<script lang="ts">
  import type { Contact } from "../../providers/types";

  let { contact, onEmail, onEdit, onDelete }: {
    contact: Contact;
    onEmail: (email: string) => void;
    onEdit: () => void;
    onDelete: () => void;
  } = $props();

  const phones = $derived([
    ...(contact.mobilePhone ? [{ label: "Mobile", value: contact.mobilePhone }] : []),
    ...contact.businessPhones.map((value) => ({ label: "Work", value })),
    ...contact.homePhones.map((value) => ({ label: "Home", value })),
  ]);
  const work = $derived([contact.jobTitle, contact.companyName].filter(Boolean).join(" · "));
</script>

<div class="oe-contact-detail">
  <header class="oe-contact-detail-head">
    <h3>{contact.displayName}</h3>
    <button type="button" class="oe-contact-edit" onclick={onEdit}>Edit</button>
    <button type="button" class="oe-contact-delete" onclick={onDelete}>Delete</button>
  </header>
  {#if work}<p class="oe-contact-work">{work}</p>{/if}
  {#if contact.emails.length}
    <dl class="oe-contact-fields">
      <dt>Email</dt>
      <dd>
        {#each contact.emails as e, i (i + e.email)}
          <button type="button" class="oe-contact-email" onclick={() => onEmail(e.email)}>{e.email}</button>
        {/each}
      </dd>
    </dl>
  {/if}
  {#if phones.length}
    <dl class="oe-contact-fields">
      {#each phones as p, i (i + p.label + p.value)}
        <dt>{p.label}</dt><dd>{p.value}</dd>
      {/each}
    </dl>
  {/if}
  {#if contact.notes}<p class="oe-contact-notes">{contact.notes}</p>{/if}
</div>
