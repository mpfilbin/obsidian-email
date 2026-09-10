import { describe } from "vitest";
import { FakeProvider } from "../../src/providers/fake-provider";
import { runMailProviderContract } from "../../src/providers/provider-contract";

runMailProviderContract("FakeProvider", async () => {
  const provider = new FakeProvider({
    mailboxes: [{ id: "INBOX", name: "Inbox", kind: "inbox" }],
  });
  provider.pageSize = 2;
  let n = 0;
  const seedInbox = async (count: number) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `m${++n}`;
      provider.addMessage({
        id, threadId: id, mailboxIds: ["INBOX"],
        from: { email: "s@x.com" }, to: [], cc: [],
        subject: `msg ${id}`, snippet: "", date: n * 1000,
        unread: true, hasAttachments: false, flagged: false,
      });
      ids.push(id);
    }
    return ids;
  };
  return { provider, seedInbox };
});
