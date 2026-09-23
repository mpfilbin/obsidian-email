import { describe, it, expect, vi, afterEach } from "vitest";
import { printHtml } from "../../src/view/print-html";

// jsdom doesn't perform real iframe navigation (an iframe's `load` fires
// exactly once, with no populated `contentDocument`, regardless of whether
// `srcdoc` is set before or after insertion) — confirmed against a real
// Chromium browser that setting `srcdoc` before inserting the iframe is what
// prevents an extra, premature `load` for an empty `about:blank` document.
// So instead of observing `load` timing, this locks in the mechanism of that
// fix directly: `srcdoc` must be assigned before the iframe is attached.
describe("printHtml", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll("iframe").forEach((el) => el.remove());
  });

  it("sets the iframe's srcdoc before inserting it into the document", () => {
    const order: string[] = [];
    const srcdocDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "srcdoc")!;
    vi.spyOn(HTMLIFrameElement.prototype, "srcdoc", "set").mockImplementation(function (
      this: HTMLIFrameElement,
      v: string,
    ) {
      order.push("srcdoc");
      srcdocDescriptor.set!.call(this, v);
    });
    const realAppend = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
      order.push("append");
      return realAppend(node);
    });

    printHtml("<p>hi</p>");

    expect(order).toEqual(["srcdoc", "append"]);
  });

  it("hides the iframe from assistive tech and gives it a descriptive title", () => {
    printHtml("<p>hi</p>");
    const iframe = document.querySelector("iframe")!;
    expect(iframe.getAttribute("aria-hidden")).toBe("true");
    expect(iframe.getAttribute("tabindex")).toBe("-1");
    expect(iframe.title).toBe("Print preview");
  });
});
