import { describe, it, expect } from "vitest";
import type { MailProvider, MessageSummaryPatch } from "./types";

export function runMailProviderContract(
  name: string,
  makeProvider: () => Promise<{
    provider: MailProvider;
    seedInbox: (n: number) => Promise<string[]>;
  }>,
): void {
  describe(`${name} — MailProvider contract`, () => {
    it("paginates listMessages", async () => {
      const { provider, seedInbox } = await makeProvider();
      await seedInbox(5);
      const first = await provider.listMessages("INBOX");
      expect(first.items.length).toBeGreaterThan(0);
      let count = first.items.length;
      let token = first.nextPageToken;
      const seen = new Set(first.items.map((m) => m.id));
      while (token) {
        const next = await provider.listMessages("INBOX", token);
        next.items.forEach((m) => seen.add(m.id));
        count += next.items.length;
        token = next.nextPageToken;
      }
      expect(seen.size).toBe(5);
    });

    it("round-trips a cursor and reports upserts", async () => {
      const { provider, seedInbox } = await makeProvider();
      await seedInbox(1);
      const cursor = await provider.initialCursor();
      const added = await seedInbox(2);
      const result = await provider.syncSince(cursor);
      const upsertIds = result.upserts.map((m: MessageSummaryPatch) => m.id);
      added.forEach((id) => expect(upsertIds).toContain(id));
      expect(result.cursor).toBeTruthy();
    });

    it("reports deletions in syncSince", async () => {
      const { provider, seedInbox } = await makeProvider();
      const ids = await seedInbox(2);
      const cursor = await provider.initialCursor();
      // deletion is provider-specific; the fake removes, real adapters
      // simulate via mocked history/delta fixtures in their own tests.
      if ("removeMessage" in provider) {
        (provider as unknown as { removeMessage: (id: string) => void })
          .removeMessage(ids[0]);
        const result = await provider.syncSince(cursor);
        expect(result.deletions).toContain(ids[0]);
      }
    });
  });
}
