import { describe, it, expect } from "vitest";
import { mapSettledLimit } from "../../src/util/concurrency";

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("mapSettledLimit", () => {
  it("returns settled results in input order", async () => {
    const out = await mapSettledLimit([3, 1, 2], 2, async (n) => { await new Promise((r) => setTimeout(r, n * 3)); return n * 10; });
    expect(out).toEqual([
      { status: "fulfilled", value: 30 }, { status: "fulfilled", value: 10 }, { status: "fulfilled", value: 20 },
    ]);
  });

  it("never runs more than `limit` calls at once", async () => {
    let inFlight = 0; let peak = 0;
    await mapSettledLimit(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      peak = Math.max(peak, ++inFlight);
      await tick();
      inFlight--;
    });
    expect(peak).toBe(4);
  });

  it("uses fewer workers than the limit when there are fewer items", async () => {
    let inFlight = 0; let peak = 0;
    await mapSettledLimit([1, 2], 10, async () => { peak = Math.max(peak, ++inFlight); await tick(); inFlight--; });
    expect(peak).toBe(2);
  });

  it("keeps going after a rejection and reports it in place", async () => {
    const seen: number[] = [];
    const out = await mapSettledLimit([1, 2, 3, 4], 2, async (n) => {
      seen.push(n);
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4]);
    expect(out.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled", "fulfilled"]);
    expect((out[1] as PromiseRejectedResult).reason).toEqual(new Error("boom"));
  });

  it("handles an empty input and a non-positive limit", async () => {
    expect(await mapSettledLimit([], 3, async () => 1)).toEqual([]);
    expect(await mapSettledLimit([1, 2], 0, async (n) => n)).toEqual([
      { status: "fulfilled", value: 1 }, { status: "fulfilled", value: 2 },
    ]);
  });

  it("passes the index to the callback", async () => {
    const out = await mapSettledLimit(["a", "b"], 2, async (s, i) => `${s}${i}`);
    expect(out.map((r) => (r as PromiseFulfilledResult<string>).value)).toEqual(["a0", "b1"]);
  });
});
