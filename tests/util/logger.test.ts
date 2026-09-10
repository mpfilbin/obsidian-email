import { describe, it, expect, vi } from "vitest";
import { Logger } from "../../src/util/logger";

describe("Logger", () => {
  it("suppresses debug when the debug flag is false", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    new Logger("test", { debug: () => false }).debug("hidden");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("emits debug when the flag is true, prefixed with scope", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    new Logger("auth", { debug: () => true }).debug("hello");
    expect(spy).toHaveBeenCalledWith("[obsidian-email-auth] hello");
    spy.mockRestore();
  });

  it("always emits warn and error", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    new Logger("x", { debug: () => false }).warn("careful");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
