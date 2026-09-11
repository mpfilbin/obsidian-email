import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import Composer from "../../src/view/components/Composer.svelte";

function baseProps(over: Partial<Record<string, unknown>> = {}) {
  return {
    mode: "new" as const,
    to: [], cc: [], bcc: [], subject: "", bodyHtml: "",
    sending: false, error: null,
    onFieldsChange: vi.fn(), onBodyChange: vi.fn(), onSend: vi.fn(), onSaveDraft: vi.fn(), onDiscard: vi.fn(),
    ...over,
  };
}

describe("Composer smoke", () => {
  it("mode=new shows To/Cc/Bcc/Subject fields and a Save draft button", () => {
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps() });
    flushSync();
    expect(host.querySelector('input[data-field="to"]')).not.toBeNull();
    expect(host.querySelector('input[data-field="cc"]')).not.toBeNull();
    expect(host.querySelector('input[data-field="bcc"]')).not.toBeNull();
    expect(host.querySelector('input[data-field="subject"]')).not.toBeNull();
    expect(host.querySelector(".oe-composer-save")).not.toBeNull();
    unmount(app);
  });

  it("mode=reply shows no recipient/subject fields or Save draft button", () => {
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps({ mode: "reply" }) });
    flushSync();
    expect(host.querySelector('input[data-field="to"]')).toBeNull();
    expect(host.querySelector('input[data-field="subject"]')).toBeNull();
    expect(host.querySelector(".oe-composer-save")).toBeNull();
    unmount(app);
  });

  it("mode=forward shows only a To field, no Cc/Bcc/Subject/Save draft", () => {
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps({ mode: "forward" }) });
    flushSync();
    expect(host.querySelector('input[data-field="to"]')).not.toBeNull();
    expect(host.querySelector('input[data-field="cc"]')).toBeNull();
    expect(host.querySelector('input[data-field="subject"]')).toBeNull();
    expect(host.querySelector(".oe-composer-save")).toBeNull();
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

  it("Send/Save draft/Discard buttons call their callbacks", () => {
    const onSend = vi.fn(), onSaveDraft = vi.fn(), onDiscard = vi.fn();
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps({ onSend, onSaveDraft, onDiscard }) });
    flushSync();
    host.querySelector<HTMLButtonElement>(".oe-composer-send")!.click();
    host.querySelector<HTMLButtonElement>(".oe-composer-save")!.click();
    host.querySelector<HTMLButtonElement>(".oe-composer-discard")!.click();
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSaveDraft).toHaveBeenCalledOnce();
    expect(onDiscard).toHaveBeenCalledOnce();
    unmount(app);
  });

  it("shows the error message when present, and disables Send while sending", () => {
    const host = document.createElement("div");
    const app = mount(Composer, { target: host, props: baseProps({ error: "boom", sending: true }) });
    flushSync();
    expect(host.textContent).toContain("boom");
    expect(host.querySelector<HTMLButtonElement>(".oe-composer-send")!.disabled).toBe(true);
    unmount(app);
  });
});
