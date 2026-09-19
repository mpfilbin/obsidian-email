<script lang="ts">
  import Ribbon from "../../../src/view/ribbon/Ribbon.svelte";
  import type { RibbonContext } from "../../../src/view/ribbon/registry";

  let { initial, defaultCollapsed = false }: { initial: RibbonContext; defaultCollapsed?: boolean } = $props();

  // svelte-ignore state_referenced_locally
  let ctx = $state(initial);
  export function set(next: RibbonContext): void { ctx = next; }
</script>

<Ribbon {ctx} {defaultCollapsed} />
