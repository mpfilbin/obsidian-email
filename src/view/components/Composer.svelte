<script lang="ts">
  import Quill from "quill";
  import type { Address } from "../../providers/types";
  import { parseRecipients } from "../parse-recipients";

  let { mode, to, cc, bcc, subject, bodyHtml, sending, error, onFieldsChange, onBodyChange, onSend, onSaveDraft, onDiscard }: {
    mode: "reply" | "replyAll" | "forward" | "new" | "editDraft";
    to: Address[]; cc: Address[]; bcc: Address[]; subject: string; bodyHtml: string;
    sending: boolean; error: string | null;
    onFieldsChange: (patch: Partial<{ to: Address[]; cc: Address[]; bcc: Address[]; subject: string }>) => void;
    onBodyChange: (html: string) => void;
    onSend: () => void;
    onSaveDraft: () => void;
    onDiscard: () => void;
  } = $props();

  const showRecipients = $derived(mode === "forward" || mode === "new" || mode === "editDraft");
  const showCcBccSubject = $derived(mode === "new" || mode === "editDraft");
  const showSave = $derived(mode === "new" || mode === "editDraft");
  const sendLabel = $derived(mode === "new" || mode === "editDraft" ? "Send" : mode === "forward" ? "Forward" : "Reply");

  const fmtAddrs = (addrs: Address[]) => addrs.map((a) => a.email).join(", ");
  let toText = $state(fmtAddrs(to));
  let ccText = $state(fmtAddrs(cc));
  let bccText = $state(fmtAddrs(bcc));
  let subjectText = $state(subject);
  let parseWarning = $state<string | null>(null);

  function commitField(field: "to" | "cc" | "bcc", raw: string): void {
    const parsed = parseRecipients(raw);
    if (parsed === null) {
      parseWarning = `Couldn't recognize an address in "${field}" — check for a missing "@".`;
      return;
    }
    parseWarning = null;
    onFieldsChange({ [field]: parsed } as Partial<{ to: Address[]; cc: Address[]; bcc: Address[] }>);
  }

  let editorHost: HTMLDivElement | null = null;
  let quill: Quill | null = null;

  $effect(() => {
    if (!editorHost) return;
    const q = new Quill(editorHost, {
      theme: "snow",
      modules: { toolbar: ["bold", "italic", "underline", { list: "ordered" }, { list: "bullet" }, "link"] },
    });
    if (bodyHtml) q.clipboard.dangerouslyPasteHTML(bodyHtml);
    quill = q;
    const onChange = () => onBodyChange(q.root.innerHTML);
    q.on("text-change", onChange);
    return () => {
      q.off("text-change", onChange);
      quill = null;
    };
  });
</script>

<div class="oe-composer">
  {#if showRecipients}
    <label class="oe-composer-field">
      <span>To</span>
      <input
        type="text" data-field="to" value={toText}
        oninput={(e) => (toText = e.currentTarget.value)}
        onchange={(e) => commitField("to", e.currentTarget.value)}
      />
    </label>
  {/if}
  {#if showCcBccSubject}
    <label class="oe-composer-field">
      <span>Cc</span>
      <input
        type="text" data-field="cc" value={ccText}
        oninput={(e) => (ccText = e.currentTarget.value)}
        onchange={(e) => commitField("cc", e.currentTarget.value)}
      />
    </label>
    <label class="oe-composer-field">
      <span>Bcc</span>
      <input
        type="text" data-field="bcc" value={bccText}
        oninput={(e) => (bccText = e.currentTarget.value)}
        onchange={(e) => commitField("bcc", e.currentTarget.value)}
      />
    </label>
    <label class="oe-composer-field">
      <span>Subject</span>
      <input
        type="text" data-field="subject" value={subjectText}
        oninput={(e) => (subjectText = e.currentTarget.value)}
        onchange={(e) => onFieldsChange({ subject: e.currentTarget.value })}
      />
    </label>
  {/if}
  {#if parseWarning}<p class="oe-composer-warning">{parseWarning}</p>{/if}

  <div class="oe-composer-editor" bind:this={editorHost}></div>

  {#if error}<p class="oe-composer-error">{error}</p>{/if}

  <div class="oe-composer-actions">
    <button type="button" class="oe-composer-send" disabled={sending} onclick={onSend}>{sendLabel}</button>
    {#if showSave}
      <button type="button" class="oe-composer-save" disabled={sending} onclick={onSaveDraft}>Save draft</button>
    {/if}
    <button type="button" class="oe-composer-discard" disabled={sending} onclick={onDiscard}>Discard</button>
  </div>
</div>
