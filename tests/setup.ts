import "fake-indexeddb/auto";

// jsdom does not implement the object-URL APIs; provide minimal shims so code
// under test (and spies over them) work in the test environment.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => `blob:mock/${Math.random().toString(36).slice(2)}`;
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
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
