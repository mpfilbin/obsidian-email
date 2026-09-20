<script lang="ts">
  import type { Address, ContactDraft } from "../../providers/types";
  import type { ContactEditState } from "../view-model";
  import { MAX_CONTACT_EMAILS } from "../contact-draft";
  import { parseRecipients } from "../parse-recipients";

  let { edit, onChange, onSave, onCancel }: {
    edit: ContactEditState;
    onChange: (patch: Partial<ContactDraft>) => void;
    onSave: () => void;
    onCancel: () => void;
  } = $props();

  const fmtAddrs = (l: Address[]) => l.map((a) => a.email).join(", ");
  const splitList = (raw: string) => raw.split(",").map((s) => s.trim()).filter(Boolean);

  // Emails and phone lists are comma-separated text mirrors, committed on
  // change (blur / Enter) — committing per keystroke would re-normalize the
  // text under the cursor, exactly as the composer's recipient fields avoid.
  // svelte-ignore state_referenced_locally
  let emailsText = $state(fmtAddrs(edit.draft.emails));
  $effect(() => { emailsText = fmtAddrs(edit.draft.emails); });
  // svelte-ignore state_referenced_locally
  let businessText = $state(edit.draft.businessPhones.join(", "));
  $effect(() => { businessText = edit.draft.businessPhones.join(", "); });
  // svelte-ignore state_referenced_locally
  let homeText = $state(edit.draft.homePhones.join(", "));
  $effect(() => { homeText = edit.draft.homePhones.join(", "); });
  let emailWarning = $state<string | null>(null);

  function commitEmails(raw: string): void {
    const parsed = parseRecipients(raw);
    if (parsed === null) {
      emailWarning = `Couldn't recognize an address — an entry is missing an "@".`;
      return;
    }
    emailWarning = null;
    onChange({ emails: parsed });
  }
</script>

<form class="oe-contact-form" onsubmit={(e) => { e.preventDefault(); onSave(); }}>
  <h3 class="oe-contact-form-title">{edit.mode === "new" ? "New contact" : "Edit contact"}</h3>
  <label class="oe-composer-field"><span>Name</span>
    <input type="text" data-field="contact-displayName" value={edit.draft.displayName} oninput={(e) => onChange({ displayName: e.currentTarget.value })} /></label>
  <label class="oe-composer-field"><span>First</span>
    <input type="text" data-field="contact-givenName" value={edit.draft.givenName ?? ""} oninput={(e) => onChange({ givenName: e.currentTarget.value })} /></label>
  <label class="oe-composer-field"><span>Last</span>
    <input type="text" data-field="contact-surname" value={edit.draft.surname ?? ""} oninput={(e) => onChange({ surname: e.currentTarget.value })} /></label>
  <label class="oe-composer-field"><span>Email</span>
    <input
      type="text" data-field="contact-emails" value={emailsText} placeholder={`up to ${MAX_CONTACT_EMAILS}, comma-separated`}
      oninput={(e) => (emailsText = e.currentTarget.value)}
      onchange={(e) => commitEmails(e.currentTarget.value)}
    /></label>
  <label class="oe-composer-field"><span>Mobile</span>
    <input type="text" data-field="contact-mobilePhone" value={edit.draft.mobilePhone ?? ""} oninput={(e) => onChange({ mobilePhone: e.currentTarget.value })} /></label>
  <label class="oe-composer-field"><span>Work</span>
    <input
      type="text" data-field="contact-businessPhones" value={businessText}
      oninput={(e) => (businessText = e.currentTarget.value)}
      onchange={(e) => onChange({ businessPhones: splitList(e.currentTarget.value) })}
    /></label>
  <label class="oe-composer-field"><span>Home</span>
    <input
      type="text" data-field="contact-homePhones" value={homeText}
      oninput={(e) => (homeText = e.currentTarget.value)}
      onchange={(e) => onChange({ homePhones: splitList(e.currentTarget.value) })}
    /></label>
  <label class="oe-composer-field"><span>Company</span>
    <input type="text" data-field="contact-companyName" value={edit.draft.companyName ?? ""} oninput={(e) => onChange({ companyName: e.currentTarget.value })} /></label>
  <label class="oe-composer-field"><span>Title</span>
    <input type="text" data-field="contact-jobTitle" value={edit.draft.jobTitle ?? ""} oninput={(e) => onChange({ jobTitle: e.currentTarget.value })} /></label>
  <label class="oe-composer-field oe-contact-notes-field"><span>Notes</span>
    <textarea data-field="contact-notes" rows="4" value={edit.draft.notes ?? ""} oninput={(e) => onChange({ notes: e.currentTarget.value })}></textarea></label>
  {#if emailWarning}<p class="oe-composer-warning">{emailWarning}</p>{/if}
  {#if edit.error}<p class="oe-contact-form-error oe-composer-error">{edit.error}</p>{/if}
  <div class="oe-contact-form-actions">
    <button type="submit" class="oe-contact-save mod-cta" disabled={edit.saving}>{edit.saving ? "Saving…" : "Save"}</button>
    <button type="button" class="oe-contact-cancel" onclick={onCancel}>Cancel</button>
  </div>
</form>
