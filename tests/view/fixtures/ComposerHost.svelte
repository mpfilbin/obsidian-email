<script lang="ts">
  import type { Address, OutgoingAttachment } from "../../../src/providers/types";
  import Composer from "../../../src/view/components/Composer.svelte";

  let { initial, error = null, onFieldsChange, onBodyChange, onRemoveAttachment = () => {} }: {
    initial: {
      mode: "reply" | "replyAll" | "forward" | "new" | "editDraft";
      to: Address[]; cc: Address[]; bcc: Address[]; subject: string; bodyHtml: string;
      attachments?: OutgoingAttachment[];
    };
    error?: string | null;
    onFieldsChange: (patch: Partial<{ to: Address[]; cc: Address[]; bcc: Address[]; subject: string }>) => void;
    onBodyChange: (html: string) => void;
    onRemoveAttachment?: (index: number) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let fields = $state(initial);
  export function set(m: typeof initial): void { fields = m; }
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
  {onFieldsChange}
  {onBodyChange}
  {onRemoveAttachment}
/>
