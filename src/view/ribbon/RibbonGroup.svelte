<script lang="ts">
  import type { RibbonCommand, RibbonContext } from "./registry";
  import RibbonButton from "./RibbonButton.svelte";
  import RibbonDropdown from "./RibbonDropdown.svelte";

  let { label, commands, ctx }: { label: string; commands: RibbonCommand[]; ctx: RibbonContext } = $props();
</script>

<div class="oe-ribbon-group">
  <div class="oe-ribbon-group-buttons">
    {#each commands as command (command.id)}
      {#if command.options}
        <RibbonDropdown {command} {ctx} />
      {:else}
        <RibbonButton {command} {ctx} />
      {/if}
    {/each}
  </div>
  <div class="oe-ribbon-group-label">{label}</div>
</div>
