import "fake-indexeddb/auto";

// jsdom does not implement the object-URL APIs; provide minimal shims so code
// under test (and spies over them) work in the test environment.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => `blob:mock/${Math.random().toString(36).slice(2)}`;
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}
