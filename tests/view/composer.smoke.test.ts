import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import Composer from "../../src/view/components/Composer.svelte";
import ComposerHost from "./fixtures/ComposerHost.svelte";

function baseProps(over: Partial<Record<string, unknown>> = {}) {
  return {
    mode: "new" as const,
    to: [], cc: [], bcc: [], subject: "", bodyHtml: "", attachments: [],
    sending: false, error: null,
    onFieldsChange: vi.fn(), onBodyChange: vi.fn(), onRemoveAttachment: vi.fn(),
    ...over,
  };
}

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
    const app = mount(Composer, { target: host, props: baseProps({ error: "boom", sending: true }) });
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
