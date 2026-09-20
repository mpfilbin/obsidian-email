import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync, tick } from "svelte";
import Composer from "../../src/view/components/Composer.svelte";
import ComposerHost from "./fixtures/ComposerHost.svelte";

function baseProps(over: Partial<Record<string, unknown>> = {}) {
  return {
    mode: "new" as const,
    to: [], cc: [], bcc: [], subject: "", bodyHtml: "", attachments: [],
    error: null,
    onFieldsChange: vi.fn(), onBodyChange: vi.fn(), onRemoveAttachment: vi.fn(),
    ...over,
  };
}

describe("Composer focus on open", () => {
  // Focus only takes effect on an element attached to the document.
  const mountAttached = (mode: "new" | "reply" | "replyAll" | "forward" | "editDraft") => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(Composer, { target: host, props: baseProps({ mode }) });
    flushSync();
    return { host, done: () => { unmount(app); host.remove(); } };
  };

  for (const mode of ["reply", "replyAll"] as const) {
    it(`mode=${mode} focuses the message body`, () => {
      const { host, done } = mountAttached(mode);
      expect(document.activeElement).toBe(host.querySelector(".ql-editor"));
      done();
    });
  }

  it("mode=forward focuses the To field", () => {
    const { host, done } = mountAttached("forward");
    expect(document.activeElement).toBe(host.querySelector('input[data-field="to"]'));
    done();
  });

  for (const mode of ["new", "editDraft"] as const) {
    it(`mode=${mode} does not steal focus`, () => {
      const { done } = mountAttached(mode);
      expect(document.activeElement).toBe(document.body);
      done();
    });
  }
});

describe("Composer smoke", () => {
  it("mode=new shows To/Cc/Bcc/Subject fields", () => {
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps() });
    flushSync();
    expect(host.querySelector('input[data-field="to"]')).not.toBeNull();
    expect(host.querySelector('input[data-field="cc"]')).not.toBeNull();
    expect(host.querySelector('input[data-field="bcc"]')).not.toBeNull();
    expect(host.querySelector('input[data-field="subject"]')).not.toBeNull();
    unmount(app);
  });

  it("mode=reply shows no recipient/subject fields", () => {
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps({ mode: "reply" }) });
    flushSync();
    expect(host.querySelector('input[data-field="to"]')).toBeNull();
    expect(host.querySelector('input[data-field="subject"]')).toBeNull();
    unmount(app);
  });

  it("mode=forward shows only a To field, no Cc/Bcc/Subject", () => {
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps({ mode: "forward" }) });
    flushSync();
    expect(host.querySelector('input[data-field="to"]')).not.toBeNull();
    expect(host.querySelector('input[data-field="cc"]')).toBeNull();
    expect(host.querySelector('input[data-field="subject"]')).toBeNull();
    unmount(app);
  });

  it("renders the Quill toolbar and editor", () => {
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps() });
    flushSync();
    expect(host.querySelector("button.ql-bold")).not.toBeNull();
    expect(host.querySelector(".ql-editor")).not.toBeNull();
    unmount(app);
  });

  it("calling onFieldsChange when the To field changes, parsed into Address[]", () => {
    const onFieldsChange = vi.fn();
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps({ mode: "forward", onFieldsChange }) });
    flushSync();
    const toInput = host.querySelector<HTMLInputElement>('input[data-field="to"]')!;
    toInput.value = "a@x.com, b@y.com";
    toInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onFieldsChange).toHaveBeenCalledWith({ to: [{ email: "a@x.com" }, { email: "b@y.com" }] });
    unmount(app);
  });

  it("renders a chip for each staged attachment, and none when there are none", () => {
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps() });
    flushSync();
    expect(host.querySelector(".oe-composer-attachments")).toBeNull();
    unmount(app);
  });

  it("clicking an attachment's remove button calls onRemoveAttachment with its index", () => {
    const onRemoveAttachment = vi.fn();
    const host = document.createElement("div");
    const app = mount(Composer, {
      target: host,
      props: baseProps({
        attachments: [
          { filename: "a.md", mimeType: "text/markdown", contentBytes: "YQ==" },
          { filename: "b.md", mimeType: "text/markdown", contentBytes: "Yg==" },
        ],
        onRemoveAttachment,
      }),
    });
    flushSync();
    const chips = host.querySelectorAll(".oe-composer-attachment");
    expect(chips).toHaveLength(2);
    expect(chips[1].textContent).toContain("b.md");
    chips[1].querySelector<HTMLButtonElement>(".oe-composer-attachment-remove")!.click();
    expect(onRemoveAttachment).toHaveBeenCalledWith(1);
    unmount(app);
  });

  it("shows the error message when present", () => {
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps({ error: "boom" }) });
    flushSync();
    expect(host.textContent).toContain("boom");
    unmount(app);
  });

  it("resyncs local to/subject text mirrors when props change on an already-mounted instance", () => {
    const host = document.createElement("div");
    const app = mount(ComposerHost, {
      target: host,
      props: {
        initial: {
          mode: "editDraft" as const,
          to: [{ email: "a@x.com" }], cc: [], bcc: [], subject: "Draft A", bodyHtml: "",
        },
        onFieldsChange: vi.fn(), onBodyChange: vi.fn(),
      },
    });
    flushSync();
    expect(host.querySelector<HTMLInputElement>('input[data-field="to"]')!.value).toBe("a@x.com");
    expect(host.querySelector<HTMLInputElement>('input[data-field="subject"]')!.value).toBe("Draft A");

    // Simulate ReadingPane switching which draft is being edited without remounting
    // the same Composer instance (the same {#if} branch stays truthy).
    (app as unknown as { set: (m: { mode: "editDraft"; to: { email: string }[]; cc: never[]; bcc: never[]; subject: string; bodyHtml: string }) => void }).set({
      mode: "editDraft", to: [{ email: "b@y.com" }], cc: [], bcc: [], subject: "Draft B", bodyHtml: "",
    });
    flushSync();
    expect(host.querySelector<HTMLInputElement>('input[data-field="to"]')!.value).toBe("b@y.com");
    expect(host.querySelector<HTMLInputElement>('input[data-field="subject"]')!.value).toBe("Draft B");
    unmount(app);
  });

  it("does not tear down and rebuild the Quill editor when bodyHtml prop changes", () => {
    const host = document.createElement("div");
    const app = mount(ComposerHost, {
      target: host,
      props: {
        initial: { mode: "new" as const, to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>one</p>" },
        onFieldsChange: vi.fn(), onBodyChange: vi.fn(),
      },
    });
    flushSync();
    const editorBefore = host.querySelector(".ql-editor");
    expect(editorBefore).not.toBeNull();

    (app as unknown as { set: (m: { mode: "new"; to: never[]; cc: never[]; bcc: never[]; subject: string; bodyHtml: string }) => void }).set({
      mode: "new", to: [], cc: [], bcc: [], subject: "", bodyHtml: "<p>two</p>",
    });
    flushSync();
    const editorAfter = host.querySelector(".ql-editor");
    expect(editorAfter).not.toBeNull();
    expect(editorAfter).toBe(editorBefore);
    unmount(app);
  });
});

describe("Composer recipient autocomplete", () => {
  const suggestions = [{ name: "Ada Lovelace", email: "ada@x.com" }, { name: "Alan Turing", email: "alan@x.com" }];

  function mountWith(over: Partial<Record<string, unknown>> = {}) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const suggest = vi.fn(() => suggestions);
    const onFieldsChange = vi.fn();
    const app = mount(Composer, { target: host, props: baseProps({ mode: "new", suggest, onFieldsChange, ...over }) });
    flushSync();
    return { host, suggest, onFieldsChange, done: () => { unmount(app); host.remove(); } };
  }
  const input = (host: HTMLElement, field: string) => host.querySelector<HTMLInputElement>(`input[data-field="${field}"]`)!;
  const type = (el: HTMLInputElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
  };
  const press = (el: HTMLElement, key: string) => {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    flushSync();
    return e;
  };
  const items = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".oe-suggest-item")];

  it("shows suggestions for the token being typed", () => {
    const { host, suggest, done } = mountWith();
    type(input(host, "to"), "a");
    expect(suggest).toHaveBeenCalledWith("a", []);
    expect(items(host).map((i) => i.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Ada Lovelace ada@x.com", "Alan Turing alan@x.com",
    ]);
    done();
  });

  it("only searches the token after the last comma and excludes committed addresses", () => {
    const { host, suggest, done } = mountWith();
    type(input(host, "to"), "bob@x.com, al");
    expect(suggest).toHaveBeenLastCalledWith("al", ["bob@x.com"]);
    done();
  });

  it("shows nothing for an empty token or when the suggester returns nothing", () => {
    const { host, done } = mountWith({ suggest: vi.fn(() => []) });
    type(input(host, "to"), "zzz");
    expect(items(host)).toHaveLength(0);
    type(input(host, "to"), "");
    expect(items(host)).toHaveLength(0);
    done();
  });

  it("ArrowDown then Enter accepts the highlighted suggestion, committing it with a trailing separator", async () => {
    const { host, onFieldsChange, done } = mountWith();
    const to = input(host, "to");
    type(to, "a");
    expect(items(host)[0].classList.contains("is-active")).toBe(true);
    press(to, "ArrowDown");
    expect(items(host)[1].classList.contains("is-active")).toBe(true);
    const enter = press(to, "Enter");
    expect(enter.defaultPrevented).toBe(true);
    await tick();
    expect(onFieldsChange).toHaveBeenCalledWith({ to: [{ email: "alan@x.com" }] });
    await tick(); // second tick: accept() awaits its own tick before restoring the trailing separator
    expect(to.value).toBe("alan@x.com, ");
    expect(items(host)).toHaveLength(0);
    done();
  });

  it("ArrowUp wraps, Tab also accepts, Escape closes without changing the field", async () => {
    const { host, onFieldsChange, done } = mountWith();
    const to = input(host, "to");
    type(to, "a");
    press(to, "ArrowUp");
    expect(items(host)[1].classList.contains("is-active")).toBe(true);
    press(to, "Escape");
    expect(items(host)).toHaveLength(0);
    expect(onFieldsChange).not.toHaveBeenCalled();
    type(to, "a");
    press(to, "Tab");
    await tick();
    expect(onFieldsChange).toHaveBeenCalledWith({ to: [{ email: "ada@x.com" }] });
    done();
  });

  it("mousedown on a suggestion accepts it without letting the input blur", async () => {
    const { host, onFieldsChange, done } = mountWith();
    const to = input(host, "to");
    type(to, "al");
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    items(host)[1].dispatchEvent(down);
    await tick();
    expect(down.defaultPrevented).toBe(true);
    expect(onFieldsChange).toHaveBeenCalledWith({ to: [{ email: "alan@x.com" }] });
    done();
  });

  it("blur closes the dropdown", () => {
    const { host, done } = mountWith();
    const to = input(host, "to");
    type(to, "a");
    to.dispatchEvent(new FocusEvent("blur"));
    flushSync();
    expect(items(host)).toHaveLength(0);
    done();
  });

  it("keeps earlier recipients when accepting a later one", async () => {
    const { host, onFieldsChange, done } = mountWith();
    const to = input(host, "to");
    type(to, "bob@x.com, a");
    press(to, "Enter");
    await tick();
    expect(onFieldsChange).toHaveBeenCalledWith({ to: [{ email: "bob@x.com" }, { email: "ada@x.com" }] });
    await tick(); // second tick: accept() awaits its own tick before restoring the trailing separator
    expect(to.value).toBe("bob@x.com, ada@x.com, ");
    done();
  });

  it("works on Cc and Bcc, and on the forward To field", () => {
    const a = mountWith();
    type(input(a.host, "cc"), "a");
    expect(items(a.host)).toHaveLength(2);
    type(input(a.host, "bcc"), "a");
    expect(a.host.querySelectorAll(".oe-suggest")).toHaveLength(1); // only the focused field's list
    a.done();
    const f = mountWith({ mode: "forward" });
    type(input(f.host, "to"), "a");
    expect(items(f.host)).toHaveLength(2);
    f.done();
  });

  it("does nothing when no suggest prop is given", () => {
    const { host, done } = mountWith({ suggest: undefined });
    type(input(host, "to"), "a");
    expect(items(host)).toHaveLength(0);
    done();
  });

  it("survives a suggester returning two rows with the same email", () => {
    const dupes = [
      { name: "Ada Lovelace", email: "ada@x.com" },
      { name: "Ada (work)", email: "ada@x.com" },
    ];
    const { host, done } = mountWith({ suggest: vi.fn(() => dupes) });
    type(input(host, "to"), "a");
    expect(items(host).map((i) => i.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Ada Lovelace ada@x.com", "Ada (work) ada@x.com",
    ]);
    done();
  });

  // The tests above pass a plain vi.fn() for onFieldsChange, so `to` never
  // changes and the prop-sync $effect that accept() races with never re-runs.
  // This host echoes the patch back into the prop, like App → ViewModel does.
  it("accept survives the real prop round-trip and keeps the trailing separator", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onFieldsChange = vi.fn();
    const app = mount(ComposerHost, {
      target: host,
      props: {
        initial: { mode: "new" as const, to: [], cc: [], bcc: [], subject: "", bodyHtml: "" },
        echo: true,
        suggest: () => suggestions,
        onFieldsChange,
        onBodyChange: vi.fn(),
      },
    });
    flushSync();
    const to = input(host, "to");

    type(to, "a");
    press(to, "ArrowDown");
    press(to, "Enter");
    await tick();
    await tick();
    expect(to.value).toBe("alan@x.com, ");

    // A second recipient can be typed straight after and accepted.
    type(to, "alan@x.com, a");
    press(to, "Enter");
    await tick();
    await tick();
    expect(to.value).toBe("alan@x.com, ada@x.com, ");

    expect(onFieldsChange).toHaveBeenLastCalledWith({
      to: [{ email: "alan@x.com" }, { email: "ada@x.com" }],
    });
    unmount(app);
    host.remove();
  });

  it("plain Enter/Tab without a dropdown are left alone", () => {
    const { host, done } = mountWith({ suggest: vi.fn(() => []) });
    const to = input(host, "to");
    type(to, "x");
    expect(press(to, "Enter").defaultPrevented).toBe(false);
    expect(press(to, "Tab").defaultPrevented).toBe(false);
    done();
  });
});
