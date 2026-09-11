import { describe, it, expect } from "vitest";
import { CursorStore } from "../../src/cache/cursor-store";

const name = () => `cursor-db-${Date.now()}-${Math.random()}`;

describe("CursorStore", () => {
  it("round-trips a ms-graph cursor", async () => {
    const s = await CursorStore.open(name());
    await s.set("a1", { kind: "ms-graph", deltaLinks: { INBOX: "d1" } }, false);
    expect(await s.get("a1")).toEqual({
      cursor: { kind: "ms-graph", deltaLinks: { INBOX: "d1" } },
      backfillDone: false,
    });
  });

  it("overwrites and marks backfill done", async () => {
    const s = await CursorStore.open(name());
    await s.set("a1", { kind: "ms-graph", deltaLinks: { INBOX: "d1" } }, false);
    await s.set("a1", { kind: "ms-graph", deltaLinks: { INBOX: "d9" } }, true);
    expect(await s.get("a1")).toMatchObject({
      backfillDone: true,
      cursor: { deltaLinks: { INBOX: "d9" } },
    });
  });

  it("returns undefined for unknown accounts and deletes", async () => {
    const s = await CursorStore.open(name());
    expect(await s.get("nope")).toBeUndefined();
    await s.set("a1", { kind: "ms-graph", deltaLinks: {} }, true);
    await s.delete("a1");
    expect(await s.get("a1")).toBeUndefined();
  });
});
