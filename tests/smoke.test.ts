import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("has indexedDB available in the test env", () => {
    expect(typeof indexedDB).toBe("object");
  });
});
