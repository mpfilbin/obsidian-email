<script lang="ts">
  import type { AttachmentMeta, MessageBody, MessageSummary } from "../../providers/types";
  import { renderMessageBody, type RenderHandle } from "../../render/message-renderer";
  import type { ComposerFieldProps } from "../composer-props";
  import Composer from "./Composer.svelte";

  let { summary, body, expanded, autoLoadImages, renderDeps, onToggle, onDownload, composerMode, composerProps }: {
    summary: MessageSummary;
    body?: MessageBody;
    expanded: boolean;
    /** `prefs.autoLoadImages` — when true, remote content renders immediately. */
    autoLoadImages: boolean;
    renderDeps: { getInlineAttachment: (cid: string) => Promise<Blob | undefined>; openExternal: (url: string) => void };
    onToggle: () => void;
    onDownload: (att: AttachmentMeta) => void;
    composerMode: "reply" | "replyAll" | "forward" | null;
    composerProps: ComposerFieldProps | null;
  } = $props();

  let bodyEl = $state<HTMLDivElement | null>(null);
  let handle = $state<RenderHandle | null>(null);
  let blocked = $state(false);

  $effect(() => {
    if (!expanded || !body || !bodyEl) return;
    const h = renderMessageBody(bodyEl, body, { allowRemote: autoLoadImages }, renderDeps);
    handle = h;
    blocked = h.blockedRemoteContent;
    return () => { h.dispose(); handle = null; };
  });

  const fmtAddr = (a: { name?: string; email: string }) => a.name ? `${a.name} <${a.email}>` : a.email;
  const attachments = $derived((body?.attachments ?? []).filter((a) => !a.inline));
</script>

<article class="oe-message-block" class:is-expanded={expanded}>
  <header class="oe-message-head" onclick={onToggle} role="button" tabindex="0"
          onkeydown={(e) => (e.key === "Enter" ? onToggle() : null)}>
    <span class="oe-message-from">{summary.from.name || summary.from.email}</span>
    <span class="oe-message-date">{new Date(summary.date).toLocaleString()}</span>
  </header>
  {#if expanded}
    <div class="oe-message-meta">
      <div>From: {fmtAddr(summary.from)}</div>
      {#if summary.to.length}<div>To: {summary.to.map(fmtAddr).join(", ")}</div>{/if}
      {#if summary.cc.length}<div>Cc: {summary.cc.map(fmtAddr).join(", ")}</div>{/if}
    </div>
    {#if blocked}
      <button class="oe-load-images" onclick={() => { handle?.loadRemoteImages(); blocked = false; }}>
        Load remote images
      </button>
    {/if}
    {#if body}
      <div class="oe-message-body-host" bind:this={bodyEl}></div>
    {:else}
      <p class="oe-loading">Loading message…</p>
    {/if}
    {#if attachments.length}
      <div class="oe-attachments">
        {#each attachments as att (att.id)}
          <button class="oe-attachment" onclick={() => onDownload(att)}>
            📎 {att.filename} ({Math.ceil(att.size / 1024)} KB)
          </button>
        {/each}
      </div>
    {/if}
    {#if composerMode && composerProps}
      <Composer mode={composerMode} {...composerProps} />
    {/if}
  {/if}
</article>
