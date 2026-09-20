<script lang="ts">
  import type { Contact, ContactDraft } from "../../../src/providers/types";
  import type { ContactEditState } from "../../../src/view/view-model";
  import ContactPane from "../../../src/view/components/ContactPane.svelte";

  let { contact = null, initial, onEmail = () => {}, onEdit = () => {}, onDelete = () => {},
        onChange = () => {}, onSave = () => {}, onCancel = () => {} }: {
    contact?: Contact | null;
    initial: ContactEditState | null;
    onEmail?: (email: string) => void;
    onEdit?: () => void;
    onDelete?: () => void;
    onChange?: (patch: Partial<ContactDraft>) => void;
    onSave?: () => void;
    onCancel?: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let edit = $state.raw(initial);
  /** Replaces the whole edit object, like the view-model does. */
  export function set(next: ContactEditState | null): void { edit = next; }
</script>

<ContactPane {contact} {edit} {onEmail} {onEdit} {onDelete} {onChange} {onSave} {onCancel} />
