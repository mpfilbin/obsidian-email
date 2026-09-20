<script lang="ts">
  import Quill from "quill";
  import { tick, untrack } from "svelte";
  import type { Address, OutgoingAttachment } from "../../providers/types";
  import { parseRecipients } from "../parse-recipients";
  import { currentToken, excludedEmails, replaceToken, type RecipientSuggestion } from "../recipient-suggest";

  let { mode, to, cc, bcc, subject, bodyHtml, attachments, error, suggest, onFieldsChange, onBodyChange, onRemoveAttachment }: {
    mode: "reply" | "replyAll" | "forward" | "new" | "editDraft";
    to: Address[]; cc: Address[]; bcc: Address[]; subject: string; bodyHtml: string;
    attachments: OutgoingAttachment[];
    error: string | null;
    suggest?: (token: string, exclude: string[]) => RecipientSuggestion[];
    onFieldsChange: (patch: Partial<{ to: Address[]; cc: Address[]; bcc: Address[]; subject: string }>) => void;
    onBodyChange: (html: string) => void;
    onRemoveAttachment: (index: number) => void;
  } = $props();

  const showRecipients = $derived(mode === "forward" || mode === "new" || mode === "editDraft");
  const showCcBccSubject = $derived(mode === "new" || mode === "editDraft");

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

  type RecipientField = "to" | "cc" | "bcc";

  function commitField(field: RecipientField, raw: string): void {
    const parsed = parseRecipients(raw);
    if (parsed === null) {
      parseWarning = `Couldn't recognize an address in "${field}" — check for a missing "@".`;
      return;
    }
    parseWarning = null;
    onFieldsChange({ [field]: parsed } as Partial<{ to: Address[]; cc: Address[]; bcc: Address[] }>);
  }

  const textOf = (f: RecipientField) => (f === "to" ? toText : f === "cc" ? ccText : bccText);
  function setText(f: RecipientField, v: string): void {
    if (f === "to") toText = v;
    else if (f === "cc") ccText = v;
    else bccText = v;
  }

  // Contact autocomplete. One dropdown at a time, owned by the focused field.
  let suggestField = $state<RecipientField | null>(null);
  let suggestions = $state<RecipientSuggestion[]>([]);
  let highlight = $state(0);

  function closeSuggestions(): void {
    suggestField = null;
    suggestions = [];
    highlight = 0;
  }

  function refreshSuggestions(field: RecipientField, text: string): void {
    const token = currentToken(text);
    const list = suggest && token ? suggest(token, excludedEmails(text)) : [];
    if (list.length === 0) {
      closeSuggestions();
      return;
    }
    suggestField = field;
    suggestions = list;
    highlight = 0;
  }

  async function accept(field: RecipientField, s: RecipientSuggestion): Promise<void> {
    const next = replaceToken(textOf(field), s.email);
    const parsed = parseRecipients(next);
    closeSuggestions();
    if (parsed === null) return;
    commitField(field, next);
    // The prop round-trip re-syncs the text mirror to the bare addresses;
    // restore the trailing separator once it has settled so typing can continue.
    await tick();
    setText(field, `${fmtAddrs(parsed)}, `);
  }

  function onRecipientKeydown(e: KeyboardEvent, field: RecipientField): void {
    if (suggestField !== field || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlight = (highlight + 1) % suggestions.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlight = (highlight - 1 + suggestions.length) % suggestions.length;
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      void accept(field, suggestions[highlight]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSuggestions();
    }
  }

  let editorHost: HTMLDivElement | null = null;
  let inputs = $state<Record<RecipientField, HTMLInputElement | null>>({ to: null, cc: null, bcc: null });
  let quill: Quill | null = null;

  // An inline reply/forward opens ready to type: Reply and Reply all in the
  // message body, Forward in the To field. New message / Edit draft keep their
  // existing behaviour (no auto-focus). ReadingPane uses a {#key} block so each
  // new reply/forward gets a fresh instance and `mode` is fixed for its life;
  // new ↔ edit-draft can share an instance and switch `mode`, but neither path
  // auto-focuses. `mode` is read untracked so a new ↔ edit-draft switch never
  // rebuilds the editor or re-triggers the focus effect.
  const isReply = (m: typeof mode) => m === "reply" || m === "replyAll";

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
    if (isReply(untrack(() => mode))) q.focus();
    const onChange = () => onBodyChange(q.root.innerHTML);
    q.on("text-change", onChange);
    return () => {
      q.off("text-change", onChange);
      quill = null;
    };
  });

  $effect(() => {
    if (untrack(() => mode) === "forward") inputs.to?.focus();
  });
</script>

{#snippet recipient(field: RecipientField, label: string)}
  <label class="oe-composer-field">
    <span>{label}</span>
    <div class="oe-recipient">
      <input
        type="text" data-field={field} value={textOf(field)} bind:this={inputs[field]}
        autocomplete="off"
        oninput={(e) => { setText(field, e.currentTarget.value); refreshSuggestions(field, e.currentTarget.value); }}
        onchange={(e) => commitField(field, e.currentTarget.value)}
        onkeydown={(e) => onRecipientKeydown(e, field)}
        onblur={closeSuggestions}
      />
      {#if suggestField === field}
        <ul class="oe-suggest" role="listbox">
          {#each suggestions as s, i (s.email)}
            <li
              role="option" tabindex="-1" aria-selected={i === highlight}
              class="oe-suggest-item" class:is-active={i === highlight}
              onmousedown={(e) => { e.preventDefault(); void accept(field, s); }}
            >
              {#if s.name}<span class="oe-suggest-name">{s.name}</span>{/if}
              <span class="oe-suggest-email">{s.email}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </label>
{/snippet}

<div class="oe-composer">
  {#if showRecipients}{@render recipient("to", "To")}{/if}
  {#if showCcBccSubject}
    {@render recipient("cc", "Cc")}
    {@render recipient("bcc", "Bcc")}
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
</div>
