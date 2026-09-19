<script lang="ts">
  import { icon } from "../icon-action";
  import type { RibbonCommand, RibbonContext } from "./registry";

  let { command, ctx }: { command: RibbonCommand; ctx: RibbonContext } = $props();
  const enabled = $derived(command.enabled(ctx));
  const pressed = $derived(command.pressed?.(ctx));
</script>

<button type="button" class="oe-ribbon-button" class:active={pressed} data-action={command.id}
        aria-pressed={pressed}
        title={command.label} aria-label={command.label} disabled={!enabled}
        onclick={() => command.run?.(ctx)}>
  <span class="oe-ribbon-icon" use:icon={command.icon}></span>
  <span class="oe-ribbon-label">{command.label}</span>
</button>
