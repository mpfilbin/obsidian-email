<script lang="ts">
  import { icon } from "../icon-action";
  import type { RibbonCommand, RibbonContext } from "./registry";

  let { command, ctx }: { command: RibbonCommand; ctx: RibbonContext } = $props();
  const enabled = $derived(command.enabled(ctx));
  const options = $derived(command.options?.(ctx) ?? []);
  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (root && !root.contains(e.target as Node)) open = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") open = false; };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  });
  // A dropdown whose command becomes disabled must not stay open.
  $effect(() => { if (!enabled) open = false; });
</script>

<div class="oe-ribbon-dropdown" bind:this={root}>
  <button type="button" class="oe-ribbon-button" data-action={command.id}
          title={command.label} aria-label={command.label} aria-haspopup="menu" aria-expanded={open}
          disabled={!enabled} onclick={() => (open = !open)}>
    <span class="oe-ribbon-icon" use:icon={command.icon}></span>
    <span class="oe-ribbon-label">{command.label} ▾</span>
  </button>
  {#if open}
    <div class="oe-ribbon-menu" role="menu">
      {#each options as option (option.id)}
        <button type="button" role="menuitem" class="oe-ribbon-menu-item" data-option={option.id}
                onclick={() => { open = false; option.run(); }}>{option.label}</button>
      {/each}
    </div>
  {/if}
</div>
