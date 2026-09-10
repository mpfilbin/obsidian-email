import { describe, it, expect, vi } from "vitest";
import { renderMessageBody } from "../../src/render/message-renderer";
import type { MessageBody } from "../../src/providers/types";

const body = (over: Partial<MessageBody> = {}): MessageBody => ({
  id: "m1", html: null, text: null, attachments: [], headers: {}, ...over,
});

const deps = () => ({
  getInlineAttachment: vi.fn(async () => new Blob(["x"], { type: "image/png" })),
  openExternal: vi.fn(),
});

describe("renderMessageBody", () => {
  it("renders plain text when there is no html", () => {
    const el = document.createElement("div");
    renderMessageBody(el, body({ text: "hello <b>not bold</b>" }), { allowRemote: false }, deps());
    expect(el.textContent).toContain("hello <b>not bold</b>");
    expect(el.querySelector("b")).toBeNull();
  });

  it("reports blocked remote content", () => {
    const el = document.createElement("div");
    const h = renderMessageBody(el, body({ html: '<img src="https://t.example/p.gif">' }), { allowRemote: false }, deps());
    expect(h.blockedRemoteContent).toBe(true);
  });

  it("loadRemoteImages swaps blocked images in", () => {
    const el = document.createElement("div");
    const h = renderMessageBody(el, body({ html: '<img src="https://cdn.example/l.png">' }), { allowRemote: false }, deps());
    h.loadRemoteImages();
    expect(el.querySelector("img")!.getAttribute("src")).toBe("https://cdn.example/l.png");
  });

  it("binds each link once even after loadRemoteImages", () => {
    const d = deps();
    const el = document.createElement("div");
    const h = renderMessageBody(
      el,
      body({ html: '<a href="https://example.com">go</a><img src="https://cdn.example/l.png">' }),
      { allowRemote: false },
      d,
    );
    h.loadRemoteImages();
    el.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(d.openExternal).toHaveBeenCalledTimes(1);
  });

  it("resolves cid: images from inline attachments", async () => {
    const d = deps();
    const el = document.createElement("div");
    renderMessageBody(
      el,
      body({
        html: '<img src="cid:logo42">',
        attachments: [{ id: "a1", filename: "l.png", mimeType: "image/png", size: 1, inline: true, contentId: "logo42" }],
      }),
      { allowRemote: false },
      d,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(d.getInlineAttachment).toHaveBeenCalledWith("logo42");
    expect(el.querySelector("img")!.getAttribute("src")).toMatch(/^blob:|^data:/);
  });

  it("intercepts link clicks and calls openExternal", () => {
    const d = deps();
    const el = document.createElement("div");
    renderMessageBody(el, body({ html: '<a href="https://example.com">go</a>' }), { allowRemote: false }, d);
    el.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(d.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("dispose revokes created object URLs", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    const el = document.createElement("div");
    const h = renderMessageBody(
      el,
      body({
        html: '<img src="cid:c1">',
        attachments: [{ id: "a", filename: "x", mimeType: "image/png", size: 1, inline: true, contentId: "c1" }],
      }),
      { allowRemote: false },
      deps(),
    );
    await Promise.resolve(); await Promise.resolve();
    h.dispose();
    expect(revoke).toHaveBeenCalledWith("blob:fake");
    revoke.mockRestore();
  });
});
