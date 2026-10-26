import { describe, it, expect, vi, afterEach } from "vitest";
import * as obsidian from "obsidian";
import { showOperationToast } from "../../src/view/operation-toast";

describe("showOperationToast", () => {
  afterEach(() => vi.restoreAllMocks());

  function spyNotice() {
    const hide = vi.fn();
    const spy = vi.spyOn(obsidian, "Notice").mockImplementation((function () { return { hide }; }) as never);
    return { hide, spy };
  }

  it("creates one persistent Notice with the icon and text", () => {
    const { spy } = spyNotice();
    showOperationToast("Deleting 3 messages… 0/3");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(0);
    const frag = spy.mock.calls[0][0] as DocumentFragment;
    expect(frag.textContent).toBe("Deleting 3 messages… 0/3");
    expect(frag.querySelector(".oe-toast-icon")?.getAttribute("data-icon")).toBe("loader");
  });

  it("update rewrites the text in place without creating another Notice", () => {
    const { spy } = spyNotice();
    const toast = showOperationToast("a");
    const frag = spy.mock.calls[0][0] as DocumentFragment;
    toast.update("b");
    expect(frag.textContent).toBe("b");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("hide dismisses once, and later updates are ignored", () => {
    const { spy, hide } = spyNotice();
    const toast = showOperationToast("a");
    const frag = spy.mock.calls[0][0] as DocumentFragment;
    toast.hide();
    toast.hide();
    toast.update("late");
    expect(hide).toHaveBeenCalledOnce();
    expect(frag.textContent).toBe("a");
  });
});
