import { describe, it, expect, vi } from "vitest";
import { CacheOpenTimeout, openWithTimeout } from "../../src/cache/open-with-timeout";

describe("openWithTimeout", () => {
  it("resolves a prompt open untouched", async () => {
    const handle = { close: vi.fn() };
    await expect(openWithTimeout(async () => handle, 50)).resolves.toBe(handle);
    expect(handle.close).not.toHaveBeenCalled();
  });

  it("rejects with CacheOpenTimeout when the open never settles", async () => {
    const err = await openWithTimeout<{ close(): void }>(() => new Promise(() => {}), 10).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(CacheOpenTimeout);
    expect((err as Error).name).toBe("CacheOpenTimeout");
  });

  it("closes a connection that arrives after the timeout", async () => {
    const handle = { close: vi.fn() };
    let release!: (h: typeof handle) => void;
    const open = () => new Promise<typeof handle>((res) => { release = res; });

    await expect(openWithTimeout(open, 10)).rejects.toBeInstanceOf(CacheOpenTimeout);
    release(handle);
    await Promise.resolve();
    await Promise.resolve();
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it("propagates a genuine open failure unchanged", async () => {
    const boom = new Error("idb unavailable");
    await expect(
      openWithTimeout<{ close(): void }>(() => Promise.reject(boom), 50),
    ).rejects.toBe(boom);
  });
});
