import { vi } from "vitest";
import { MemoryContactStore } from "../../src/cache/contact-cache";
import { ContactSync } from "../../src/sync/contact-sync";
import { Logger } from "../../src/util/logger";
import type { MailProvider } from "../../src/providers/types";

/** The three contact-related ViewModelDeps, backed by in-memory fakes. */
export function contactDeps(getProvider: (id: string) => MailProvider | undefined, accountIds: string[] = ["a1"]) {
  const contactStore = new MemoryContactStore();
  const contactSync = new ContactSync({
    store: contactStore, getProvider, listAccountIds: () => accountIds,
    logger: new Logger("t", { debug: () => false }),
  });
  return { contactStore, contactSync, grantContactsAccess: vi.fn(async () => {}) };
}
