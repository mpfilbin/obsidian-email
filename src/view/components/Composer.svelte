<script lang="ts">
  import Quill from "quill";
  import { untrack } from "svelte";
  import type { Address, OutgoingAttachment } from "../../providers/types";
  import { parseRecipients } from "../parse-recipients";

  let { mode, to, cc, bcc, subject, bodyHtml, attachments, sending, error, onFieldsChange, onBodyChange, onRemoveAttachment, onSend, onSaveDraft, onDiscard }: {
    mode: "reply" | "replyAll" | "forward" | "new" | "editDraft";
    to: Address[]; cc: Address[]; bcc: Address[]; subject: string; bodyHtml: string;
    attachments: OutgoingAttachment[];
    sending: boolean; error: string | null;
    onFieldsChange: (patch: Partial<{ to: Address[]; cc: Address[]; bcc: Address[]; subject: string }>) => void;
    onBodyChange: (html: string) => void;
    onRemoveAttachment: (index: number) => void;
    onSend: () => void;
    onSaveDraft: () => void;
    onDiscard: () => void;
  } = $props();

  const showRecipients = $derived(mode === "forward" || mode === "new" || mode === "editDraft");
  const showCcBccSubject = $derived(mode === "new" || mode === "editDraft");
  const showSave = $derived(mode === "new" || mode === "editDraft");
  const sendLabel = $derived(mode === "new" || mode === "editDraft" ? "Send" : mode === "forward" ? "Forward" : "Reply");

  const fmtAddrs = (addrs: Address[]) => addrs.map((a) => a.email).join(", ");
  // svelte-ignore state_referenced_locally
  let toText = $state(fmtAddrs(to));
  $effect(() => { toText = fmtAddrs(to); });
  // svelte-ignore state_referenced_locally
  let ccText = $state(fmtAddrs(cc));
  $effect(() => { ccText = fmtAddrs(cc); });
  // svelte-ignore state_referenced_locally
  let bccText = $state(fmtAddrs(bcc));
  $effect(() => { bccText = fmtAddrs(bcc); });
  // svelte-ignore state_referenced_locally
  let subjectText = $state(subject);
  $effect(() => { subjectText = subject; });
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
      // Quill's link-editing tooltip clamps itself to `bounds` so it never
      // renders off-screen — without this it defaults to `document.body`,
      // which is wide enough to hide the fact that the tooltip is actually
      // bleeding out of this (much narrower) composer pane into whatever
      // sits to its left in the app's layout.
      bounds: editorHost,
      modules: { toolbar: ["bold", "italic", "underline", { list: "ordered" }, { list: "bullet" }, "link"] },
    });
    const initialHtml = untrack(() => bodyHtml);
    if (initialHtml) q.clipboard.dangerouslyPasteHTML(initialHtml);
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

  {#if attachments.length}
    <ul class="oe-composer-attachments">
      {#each attachments as att, i (att.filename)}
        <li class="oe-composer-attachment">
          <span class="oe-composer-attachment-name">{att.filename}</span>
          <button
            type="button" class="oe-composer-attachment-remove"
            aria-label={`Remove ${att.filename}`}
            onclick={() => onRemoveAttachment(i)}
          >×</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if error}<p class="oe-composer-error">{error}</p>{/if}

  <div class="oe-composer-actions">
    <button type="button" class="oe-composer-send" disabled={sending} onclick={onSend}>{sendLabel}</button>
    {#if showSave}
      <button type="button" class="oe-composer-save" disabled={sending} onclick={onSaveDraft}>Save draft</button>
    {/if}
    <button type="button" class="oe-composer-discard" disabled={sending} onclick={onDiscard}>Discard</button>
  </div>
</div>
