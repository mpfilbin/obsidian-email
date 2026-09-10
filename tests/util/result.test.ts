import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr } from "../../src/util/result";

describe("Result", () => {
  it("ok wraps a value", () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("err wraps an error", () => {
    const r = err(new Error("boom"));
    expect(isErr(r)).toBe(true);
    if (!r.ok) expect(r.error.message).toBe("boom");
  });
});
