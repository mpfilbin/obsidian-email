import { describe, it, expect, vi } from "vitest";
import { withRetry, parseRetryAfter } from "../../src/util/backoff";

const noSleep = () => Promise.resolve();

describe("parseRetryAfter", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfter("120", 0)).toBe(120_000);
  });
  it("parses an HTTP date relative to now", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(30_000);
  });
  it("returns undefined for garbage", () => {
    expect(parseRetryAfter("soon", 0)).toBeUndefined();
    expect(parseRetryAfter(undefined, 0)).toBeUndefined();
  });
});

describe("withRetry", () => {
  it("returns immediately on retry:false", async () => {
    const fn = vi.fn().mockResolvedValue({ retry: false, value: 7 });
    await expect(withRetry(fn, { retries: 3, baseMs: 1, maxMs: 10 }, noSleep)).resolves.toBe(7);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries then succeeds", async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ retry: true, error: new Error("429") })
      .mockResolvedValueOnce({ retry: false, value: "ok" });
    await expect(withRetry(fn, { retries: 3, baseMs: 1, maxMs: 10, jitter: () => 0 }, noSleep)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("clamps an explicit Retry-After to maxMs", async () => {
    const slept: number[] = [];
    const sleep = async (ms: number) => { slept.push(ms); };
    const fn = vi.fn()
      .mockResolvedValueOnce({ retry: true, afterMs: 86_400_000, error: new Error("429") })
      .mockResolvedValueOnce({ retry: false, value: "ok" });
    await expect(withRetry(fn, { retries: 3, baseMs: 500, maxMs: 8000, jitter: () => 0 }, sleep))
      .resolves.toBe("ok");
    expect(slept).toEqual([8000]);
  });

  it("still honours a Retry-After shorter than maxMs", async () => {
    const slept: number[] = [];
    const sleep = async (ms: number) => { slept.push(ms); };
    const fn = vi.fn()
      .mockResolvedValueOnce({ retry: true, afterMs: 1500, error: new Error("429") })
      .mockResolvedValueOnce({ retry: false, value: "ok" });
    await withRetry(fn, { retries: 3, baseMs: 500, maxMs: 8000, jitter: () => 0 }, sleep);
    expect(slept).toEqual([1500]);
  });

  it("throws the last error after exhausting retries", async () => {
    const fn = vi.fn().mockResolvedValue({ retry: true, error: new Error("still 503") });
    await expect(withRetry(fn, { retries: 2, baseMs: 1, maxMs: 10, jitter: () => 0 }, noSleep))
      .rejects.toThrow(/still 503/i);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
