import { describe, it, expect, vi } from "vitest";
import { handleConnect } from "../../src/settings/settings-tab";

describe("handleConnect", () => {
  it("returns ok with the new account email on success", async () => {
    const ctx = { addAccountFlow: vi.fn().mockResolvedValue({ email: "new@x.com" }) };
    const r = await handleConnect(ctx as never, { kind: "gmail", clientId: "c", clientSecret: "s" });
    expect(r).toEqual({ ok: true, message: expect.stringContaining("new@x.com") });
  });

  it("requires a client secret for Google", async () => {
    const ctx = { addAccountFlow: vi.fn() };
    const r = await handleConnect(ctx as never, { kind: "gmail", clientId: "c" });
    expect(r.ok).toBe(false);
    expect(ctx.addAccountFlow).not.toHaveBeenCalled();
  });

  it("does not require a secret for Microsoft", async () => {
    const ctx = { addAccountFlow: vi.fn().mockResolvedValue({ email: "m@x.com" }) };
    const r = await handleConnect(ctx as never, { kind: "ms-graph", clientId: "c" });
    expect(r.ok).toBe(true);
  });

  it("returns a failure message when the flow throws", async () => {
    const ctx = { addAccountFlow: vi.fn().mockRejectedValue(new Error("state mismatch")) };
    const r = await handleConnect(ctx as never, { kind: "ms-graph", clientId: "c" });
    expect(r).toEqual({ ok: false, message: expect.stringContaining("state mismatch") });
  });
});
