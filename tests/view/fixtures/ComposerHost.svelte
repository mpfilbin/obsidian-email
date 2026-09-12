<script lang="ts">
  import type { Address } from "../../../src/providers/types";
  import Composer from "../../../src/view/components/Composer.svelte";

  let { initial, sending = false, error = null, onFieldsChange, onBodyChange, onSend, onSaveDraft, onDiscard }: {
    initial: {
      mode: "reply" | "replyAll" | "forward" | "new" | "editDraft";
      to: Address[]; cc: Address[]; bcc: Address[]; subject: string; bodyHtml: string;
    };
    sending?: boolean;
    error?: string | null;
    onFieldsChange: (patch: Partial<{ to: Address[]; cc: Address[]; bcc: Address[]; subject: string }>) => void;
    onBodyChange: (html: string) => void;
    onSend: () => void;
    onSaveDraft: () => void;
    onDiscard: () => void;
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
  {sending}
  {error}
  {onFieldsChange}
  {onBodyChange}
  {onSend}
  {onSaveDraft}
  {onDiscard}
/>
