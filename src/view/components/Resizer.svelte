<script lang="ts">
  // A draggable gutter between two grid columns. `onDrag` is called with the
  // horizontal pixel delta since the last event; the caller decides how to
  // apply it (which column(s) grow/shrink, min/max clamping).
  let { onDrag, label }: { onDrag: (deltaX: number) => void; label: string } = $props();

  function startDrag(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    let lastX = e.clientX;

    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      if (dx !== 0) onDrag(dx);
    };
    const onUp = (): void => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }
</script>

<div
  class="oe-resizer"
  role="separator"
  aria-orientation="vertical"
  aria-label={label}
  onpointerdown={startDrag}
></div>
