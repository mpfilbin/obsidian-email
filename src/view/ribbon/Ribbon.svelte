<script lang="ts">
  import { untrack } from "svelte";
  import { commandsForTab, groupsForTab, visibleTabs, type RibbonContext, type TabId } from "./registry";
  import RibbonTab from "./RibbonTab.svelte";
  import RibbonGroup from "./RibbonGroup.svelte";

  let { ctx, defaultCollapsed }: { ctx: RibbonContext; defaultCollapsed: boolean } = $props();

  let activeTab = $state<TabId>("home");
  // svelte-ignore state_referenced_locally
  let collapsed = $state(defaultCollapsed);
  const tabs = $derived(visibleTabs(ctx));
  const composing = $derived(ctx.composerMode !== null);

  // A composer opening jumps to the contextual Message tab (remembering where
  // the user was); closing restores it. Anything else that removes the active
  // tab falls back to Home.
  let tabBeforeCompose: TabId | null = null;
  let wasComposing = false;
  $effect(() => {
    const now = composing;
    untrack(() => {
      if (now && !wasComposing) {
        tabBeforeCompose = activeTab === "message" ? tabBeforeCompose : activeTab;
        activeTab = "message";
      } else if (!now && wasComposing) {
        activeTab = tabBeforeCompose ?? "home";
        tabBeforeCompose = null;
      }
      wasComposing = now;
    });
  });
  $effect(() => {
    if (!tabs.some((t) => t.id === activeTab)) activeTab = "home";
  });

  const groups = $derived(groupsForTab(activeTab, ctx));
</script>

<div class="oe-ribbon" class:collapsed>
  <div class="oe-ribbon-tab-strip" role="tablist">
    {#each tabs as tab (tab.id)}
      <RibbonTab id={tab.id} label={tab.label} active={tab.id === activeTab}
                 onselect={() => (activeTab = tab.id)} ondoubleclick={() => (collapsed = !collapsed)} />
    {/each}
  </div>
  {#if !collapsed}
    <div class="oe-ribbon-panel">
      {#each groups as group (group)}
        <RibbonGroup label={group} commands={commandsForTab(activeTab, ctx).filter((c) => c.group === group)} {ctx} />
      {/each}
    </div>
  {/if}
</div>
