<script lang="ts">
  import type { ContactDraft } from "../../../src/providers/types";
  import type { ContactEditState } from "../../../src/view/view-model";
  import ContactForm from "../../../src/view/components/ContactForm.svelte";

  let { initial, onChange, onSave = () => {}, onCancel = () => {} }: {
    initial: ContactEditState;
    onChange: (patch: Partial<ContactDraft>) => void;
    onSave?: () => void;
    onCancel?: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let edit = $state.raw(initial);
  // Replaces the whole edit object, like the view-model does on every patch.
  export function set(next: ContactEditState): void { edit = next; }
</script>

<ContactForm {edit} {onChange} {onSave} {onCancel} />
