<script lang="ts">
  let { id, label, active, onselect, ondoubleclick }: {
    id: string; label: string; active: boolean; onselect: () => void; ondoubleclick: () => void;
  } = $props();
</script>

<button type="button" role="tab" aria-selected={active} class="oe-ribbon-tab" class:active data-tab={id}
        onclick={onselect} ondblclick={ondoubleclick}>{label}</button>
