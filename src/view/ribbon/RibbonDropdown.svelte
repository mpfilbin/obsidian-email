<script lang="ts">
  import { icon } from "../icon-action";
  import type { RibbonCommand, RibbonContext } from "./registry";

  let { command, ctx }: { command: RibbonCommand; ctx: RibbonContext } = $props();
  const enabled = $derived(command.enabled(ctx));
  const options = $derived(command.options?.(ctx) ?? []);
  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);
  let menu = $state<HTMLDivElement | null>(null);
  let menuTop = $state(0);
  let menuLeft = $state(0);

  const MENU_MIN_WIDTH = 160;
  const MENU_GUTTER = 4;

  // The ribbon panel scrolls horizontally (overflow-x: auto), which clips
  // absolutely-positioned children. The menu is portaled to document.body and
  // placed with position: fixed from the trigger's rect.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  function toggle(): void {
    if (!open && root) {
      const rect = root.getBoundingClientRect();
      menuTop = rect.bottom;
      menuLeft = Math.max(MENU_GUTTER, Math.min(rect.left, window.innerWidth - MENU_MIN_WIDTH - MENU_GUTTER));
    }
    open = !open;
  }

  $effect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      t instanceof Node && ((root?.contains(t) ?? false) || (menu?.contains(t) ?? false));
    const onDoc = (e: MouseEvent) => { if (!inside(e.target)) open = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") open = false; };
    // Never let the fixed menu float detached from its trigger. Scrolling the
    // menu's own list is fine.
    const onScroll = (e: Event) => { if (!inside(e.target)) open = false; };
    const onResize = () => { open = false; };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  });
  // A dropdown whose command becomes disabled must not stay open.
  $effect(() => { if (!enabled) open = false; });
</script>

<div class="oe-ribbon-dropdown" bind:this={root}>
  <button type="button" class="oe-ribbon-button" data-action={command.id}
          title={command.label} aria-label={command.label} aria-haspopup="menu" aria-expanded={open}
          disabled={!enabled} onclick={toggle}>
    <span class="oe-ribbon-icon" use:icon={command.icon}></span>
    <span class="oe-ribbon-label">{command.label} ▾</span>
  </button>
  {#if open}
    <div class="oe-ribbon-menu" role="menu" bind:this={menu} use:portal
         style="top: {menuTop}px; left: {menuLeft}px">
      {#each options as option (option.id)}
        <button type="button" role="menuitem" class="oe-ribbon-menu-item" data-option={option.id}
                onclick={() => { open = false; option.run(); }}>{option.label}</button>
      {/each}
    </div>
  {/if}
</div>
