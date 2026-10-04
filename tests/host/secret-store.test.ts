import { describe, it, expect } from "vitest";
import { makeSecretStore } from "../../src/host/secret-store";

describe("makeSecretStore", () => {
  it("adapts the synchronous secretStorage to the async SecretStore shape", async () => {
    const map = new Map<string, string>();
    const store = makeSecretStore({
      getSecret: (id) => map.get(id) ?? null,
      setSecret: (id, v) => void map.set(id, v),
    });
    expect(await store.getSecret("k")).toBeNull();
    await store.setSecret("k", "v");
    expect(map.get("k")).toBe("v");
    expect(await store.getSecret("k")).toBe("v");
  });

  it("surfaces a storage failure as a rejection", async () => {
    const store = makeSecretStore({
      getSecret: () => { throw new Error("locked"); },
      setSecret: () => { throw new Error("locked"); },
    });
    await expect(store.getSecret("k")).rejects.toThrow("locked");
    await expect(store.setSecret("k", "v")).rejects.toThrow("locked");
  });
});
