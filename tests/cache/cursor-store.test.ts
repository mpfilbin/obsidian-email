import { describe, it, expect } from "vitest";
import { CursorStore } from "../../src/cache/cursor-store";

const name = () => `cursor-db-${Date.now()}-${Math.random()}`;

describe("CursorStore", () => {
  it("round-trips a gmail cursor", async () => {
    const s = await CursorStore.open(name());
    await s.set("a1", { kind: "gmail", historyId: "42" }, false);
    expect(await s.get("a1")).toEqual({ cursor: { kind: "gmail", historyId: "42" }, backfillDone: false });
  });

  it("overwrites and marks backfill done", async () => {
    const s = await CursorStore.open(name());
    await s.set("a1", { kind: "gmail", historyId: "1" }, false);
    await s.set("a1", { kind: "gmail", historyId: "9" }, true);
    expect(await s.get("a1")).toMatchObject({ backfillDone: true, cursor: { historyId: "9" } });
  });

  it("returns undefined for unknown accounts and deletes", async () => {
    const s = await CursorStore.open(name());
    expect(await s.get("nope")).toBeUndefined();
    await s.set("a1", { kind: "ms-graph", deltaLinks: {} }, true);
    await s.delete("a1");
    expect(await s.get("a1")).toBeUndefined();
  });
});
