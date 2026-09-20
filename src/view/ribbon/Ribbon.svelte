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
  // A contextual tab — Message while composing, Contacts in contacts mode —
  // takes over while its context lasts (remembering where the user was);
  // ending the context restores the previous tab. Anything else that removes
  // the active tab falls back to Home (the guard effect below).
  const contextual = $derived<TabId | null>(
    ctx.composerMode !== null ? "message" : ctx.mode === "contacts" ? "contacts" : null,
  );

  let tabBeforeContext: TabId | null = null;
  let previousContext: TabId | null = null;
  $effect(() => {
    const now = contextual;
    untrack(() => {
      if (now && !previousContext) {
        tabBeforeContext = activeTab;
        activeTab = now;
      } else if (now && now !== previousContext) {
        activeTab = now; // one context handing over to another (contacts → message)
      } else if (!now && previousContext) {
        activeTab = tabBeforeContext ?? "home";
        tabBeforeContext = null;
      }
      previousContext = now;
    });
  });
  // Defensive guard: falls back to Home if the active tab ever becomes unavailable.
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
