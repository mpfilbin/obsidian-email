<script lang="ts">
  import type { Address, OutgoingAttachment } from "../../../src/providers/types";
  import Composer from "../../../src/view/components/Composer.svelte";

  import type { RecipientSuggestion } from "../../../src/view/recipient-suggest";

  let {
    initial, error = null, suggest, echo = false,
    onFieldsChange, onBodyChange, onRemoveAttachment = () => {},
  }: {
    initial: {
      mode: "reply" | "replyAll" | "forward" | "new" | "editDraft";
      to: Address[]; cc: Address[]; bcc: Address[]; subject: string; bodyHtml: string;
      attachments?: OutgoingAttachment[];
    };
    error?: string | null;
    suggest?: (token: string, exclude: string[]) => RecipientSuggestion[];
    /** Feeds every `onFieldsChange` patch back into the props, the way the
     *  real App → ViewModel → Composer round-trip does. */
    echo?: boolean;
    onFieldsChange: (patch: Partial<{ to: Address[]; cc: Address[]; bcc: Address[]; subject: string }>) => void;
    onBodyChange: (html: string) => void;
    onRemoveAttachment?: (index: number) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let fields = $state(initial);
  export function set(m: typeof initial): void { fields = m; }

  function handleFieldsChange(
    patch: Partial<{ to: Address[]; cc: Address[]; bcc: Address[]; subject: string }>,
  ): void {
    if (echo) fields = { ...fields, ...patch };
    onFieldsChange(patch);
  }
</script>

<Composer
  mode={fields.mode}
  to={fields.to}
  cc={fields.cc}
  bcc={fields.bcc}
  subject={fields.subject}
  bodyHtml={fields.bodyHtml}
  attachments={fields.attachments ?? []}
  {error}
  {suggest}
  onFieldsChange={handleFieldsChange}
  {onBodyChange}
  {onRemoveAttachment}
/>
