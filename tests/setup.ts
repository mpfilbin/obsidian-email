import "fake-indexeddb/auto";

// jsdom does not implement the object-URL APIs; provide minimal shims so code
// under test (and spies over them) work in the test environment.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => `blob:mock/${Math.random().toString(36).slice(2)}`;
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}

// jsdom has no PointerEvent, and Element has no pointer-capture methods; the
// pane resizer relies on both. A minimal shim keeps drag tests working.
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent !== "function") {
  class PointerEventStub extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  (globalThis as { PointerEvent?: unknown }).PointerEvent = PointerEventStub as unknown;
}
if (typeof Element.prototype.setPointerCapture !== "function") {
  Element.prototype.setPointerCapture = () => {};
}
if (typeof Element.prototype.releasePointerCapture !== "function") {
  Element.prototype.releasePointerCapture = () => {};
}

// jsdom has no IntersectionObserver; MessageList's infinite-scroll sentinel
// constructs one. A minimal no-op keeps mount/unmount working under tests
// (the visible "Load more" button remains the exercised code path).
if (typeof (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver !== "function") {
  class IntersectionObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): [] { return []; }
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    IntersectionObserverStub as unknown;
}
