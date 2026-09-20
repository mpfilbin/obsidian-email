import { describe, it, expect, vi } from "vitest";
import { ContactSync } from "../../src/sync/contact-sync";
import { MemoryContactStore } from "../../src/cache/contact-cache";
import { FakeProvider } from "../../src/providers/fake-provider";
import { Logger } from "../../src/util/logger";
import { AuthError, ContactsConsentRequired } from "../../src/providers/types";
import type { Contact, MailProvider } from "../../src/providers/types";

const logger = new Logger("t", { debug: () => false });
const c = (id: string): Contact => ({ id, displayName: id, emails: [], businessPhones: [], homePhones: [] });

function harness(provider: MailProvider | undefined, now = { t: 1_000_000 }) {
  const store = new MemoryContactStore();
  const sync = new ContactSync({
    store, logger, getProvider: () => provider, listAccountIds: () => ["a1"], now: () => now.t, minIntervalMs: 600_000,
  });
  return { store, sync, now };
}

describe("ContactSync", () => {
  it("reconciles: stores the provider's contacts and drops ones deleted remotely", async () => {
    const provider = new FakeProvider();
    provider.seedContacts([c("1"), c("2")]);
    const { store, sync, now } = harness(provider);
    await sync.syncAccount("a1");
    expect((await store.list("a1")).map((x) => x.id)).toEqual(["1", "2"]);
    await provider.deleteContact("1");
    now.t += 700_000;
    await sync.syncAccount("a1");
    expect((await store.list("a1")).map((x) => x.id)).toEqual(["2"]);
    expect(sync.getState("a1")).toMatchObject({ status: "idle", lastSyncMs: now.t });
  });

  it("emits a change per successful sync and state transitions", async () => {
    const provider = new FakeProvider();
    const { sync } = harness(provider);
    const changes: string[] = [];
    const statuses: string[] = [];
    sync.changes.on((e) => changes.push(e.accountId));
    sync.states.on((s) => statuses.push(s.status));
    await sync.syncAccount("a1");
    expect(changes).toEqual(["a1"]);
    expect(statuses).toEqual(["syncing", "idle"]);
  });

  it("throttles unless forced", async () => {
    const provider = new FakeProvider();
    const spy = vi.spyOn(provider, "listContacts");
    const { sync, now } = harness(provider);
    await sync.syncAccount("a1");
    await sync.syncAccount("a1");
    expect(spy).toHaveBeenCalledTimes(1);
    await sync.syncAccount("a1", { force: true });
    expect(spy).toHaveBeenCalledTimes(2);
    now.t += 600_000;
    await sync.syncAccount("a1");
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("dedupes a sync already in flight", async () => {
    const provider = new FakeProvider();
    const spy = vi.spyOn(provider, "listContacts");
    const { sync } = harness(provider);
    await Promise.all([sync.syncAccount("a1"), sync.syncAccount("a1", { force: true })]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("ContactsConsentRequired → needs-consent; not retried unless forced; cache untouched", async () => {
    const provider = new FakeProvider();
    provider.seedContacts([c("1")]);
    const { store, sync } = harness(provider);
    await sync.syncAccount("a1");
    provider.contactsError = new ContactsConsentRequired();
    await sync.syncAccount("a1", { force: true });
    expect(sync.getState("a1").status).toBe("needs-consent");
    expect((await store.list("a1")).map((x) => x.id)).toEqual(["1"]);
    const spy = vi.spyOn(provider, "listContacts");
    await sync.syncAccount("a1");
    expect(spy).not.toHaveBeenCalled();
    provider.contactsError = undefined;
    await sync.syncAccount("a1", { force: true });
    expect(sync.getState("a1").status).toBe("idle");
  });

  it("AuthError → needs-reauth; other errors → error with the message", async () => {
    const provider = new FakeProvider();
    const { sync } = harness(provider);
    provider.contactsError = new AuthError("Graph 401");
    await sync.syncAccount("a1", { force: true });
    expect(sync.getState("a1").status).toBe("needs-reauth");
    provider.contactsError = new Error("boom");
    await sync.syncAccount("a1", { force: true });
    expect(sync.getState("a1")).toMatchObject({ status: "error", lastError: "boom" });
  });

  it("markNeedsConsent sets the state and emits it", () => {
    const { sync } = harness(new FakeProvider());
    const seen: string[] = [];
    sync.states.on((s) => seen.push(s.status));
    sync.markNeedsConsent("a1");
    expect(sync.getState("a1").status).toBe("needs-consent");
    expect(seen).toEqual(["needs-consent"]);
  });

  it("is a no-op when the provider is missing or has no contacts support", async () => {
    const { sync } = harness(undefined);
    await sync.syncAccount("a1");
    expect(sync.getState("a1").status).toBe("idle");
    const noContacts = { kind: "ms-graph" } as unknown as MailProvider;
    const h = harness(noContacts);
    await h.sync.syncAccount("a1");
    expect(h.sync.getState("a1").status).toBe("idle");
  });

  it("forget makes an in-flight sync drop its results", async () => {
    let release!: (contacts: Contact[]) => void;
    const provider = {
      kind: "ms-graph",
      listContacts: () => new Promise<Contact[]>((res) => { release = res; }),
    } as unknown as MailProvider;
    const { store, sync } = harness(provider);
    const changes: string[] = [];
    sync.changes.on((e) => changes.push(e.accountId));

    const run = sync.syncAccount("a1", { force: true });
    sync.forget("a1");
    release([c("1"), c("2")]);
    await run;

    expect(await store.list("a1")).toEqual([]);
    expect(sync.getState("a1")).toEqual({ accountId: "a1", status: "idle" });
    expect(changes).toEqual([]);
  });

  it("an account re-added under the same id syncs normally after forget", async () => {
    const provider = new FakeProvider();
    provider.seedContacts([c("1")]);
    const { store, sync } = harness(provider);
    await sync.syncAccount("a1", { force: true });
    sync.forget("a1");
    expect(sync.getState("a1")).toEqual({ accountId: "a1", status: "idle" });

    await sync.syncAccount("a1", { force: true });
    expect((await store.list("a1")).map((x) => x.id)).toEqual(["1"]);
    expect(sync.getState("a1").status).toBe("idle");
  });

  it("syncAll syncs every listed account", async () => {
    const provider = new FakeProvider();
    provider.seedContacts([c("1")]);
    const store = new MemoryContactStore();
    const sync = new ContactSync({ store, logger, getProvider: () => provider, listAccountIds: () => ["a1", "a2"] });
    await sync.syncAll();
    expect((await store.list("a2")).map((x) => x.id)).toEqual(["1"]);
  });
});
