import { describe, it, expect } from "vitest";
import { arrayBufferToBase64 } from "../../src/util/base64";

const toBuf = (bytes: ArrayLike<number>): ArrayBuffer => Uint8Array.from(bytes).buffer;

describe("arrayBufferToBase64", () => {
  it("encodes an empty buffer as an empty string", () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
  });

  it("matches the standard encoding, including padding", () => {
    expect(arrayBufferToBase64(toBuf([...Buffer.from("f")]))).toBe("Zg==");
    expect(arrayBufferToBase64(toBuf([...Buffer.from("fo")]))).toBe("Zm8=");
    expect(arrayBufferToBase64(toBuf([...Buffer.from("foo")]))).toBe("Zm9v");
    expect(arrayBufferToBase64(toBuf([...Buffer.from("# Heading\n\nBody")]))).toBe(Buffer.from("# Heading\n\nBody").toString("base64"));
  });

  it("handles every byte value (binary, not just text)", () => {
    const all = Array.from({ length: 256 }, (_, i) => i);
    expect(arrayBufferToBase64(toBuf(all))).toBe(Buffer.from(all).toString("base64"));
  });

  it("is correct across the internal chunk boundary and for large inputs", () => {
    for (const size of [8191, 8192, 8193, 16384, 100_000]) {
      const bytes = Array.from({ length: size }, (_, i) => (i * 31 + 7) % 256);
      expect(arrayBufferToBase64(toBuf(bytes)), `size ${size}`).toBe(Buffer.from(bytes).toString("base64"));
    }
  });

  it("ignores bytes outside the given view when passed a sliced buffer", () => {
    const whole = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const slice = whole.slice(2, 5).buffer;
    expect(arrayBufferToBase64(slice)).toBe(Buffer.from([3, 4, 5]).toString("base64"));
  });
});
