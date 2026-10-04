import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import MessageList from "../../src/view/components/MessageList.svelte";

// jsdom has no IntersectionObserver; capture the one the list creates.
type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;
let observers: Array<{ cb: Callback; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>;

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(public cb: Callback) { observers.push(this as never); }
  });
});
afterEach(() => vi.unstubAllGlobals());

const props = (over: Record<string, unknown> = {}) => ({
  threads: [], openThreadId: null, hasMore: true, loading: false,
  onOpen: () => {}, onLoadMore: vi.fn(), ...over,
});

describe("MessageList — infinite scroll", () => {
  it("loads more when the sentinel scrolls into view", () => {
    const p = props();
    const app = mount(MessageList, { target: document.createElement("div"), props: p });
    flushSync();
    expect(observers).toHaveLength(1);
    observers[0].cb([{ isIntersecting: true }]);
    expect(p.onLoadMore).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("doesn't load more while a load is already in flight, or when the sentinel isn't visible", () => {
    const p = props({ loading: true });
    const app = mount(MessageList, { target: document.createElement("div"), props: p });
    flushSync();
    observers[0].cb([{ isIntersecting: true }]);
    expect(p.onLoadMore).not.toHaveBeenCalled();
    unmount(app);

    const q = props();
    const app2 = mount(MessageList, { target: document.createElement("div"), props: q });
    flushSync();
    observers[observers.length - 1].cb([{ isIntersecting: false }]);
    expect(q.onLoadMore).not.toHaveBeenCalled();
    unmount(app2);
  });

  it("doesn't observe at all when there is nothing more to load", () => {
    const app = mount(MessageList, { target: document.createElement("div"), props: props({ hasMore: false }) });
    flushSync();
    expect(observers).toHaveLength(0);
    unmount(app);
  });

  it("disconnects the observer on unmount", () => {
    const app = mount(MessageList, { target: document.createElement("div"), props: props() });
    flushSync();
    unmount(app);
    expect(observers[0].disconnect).toHaveBeenCalled();
  });
});
