import { describe, it, expect } from "vitest";
import { FakeProvider } from "../../src/providers/fake-provider";
import { runMailProviderContract } from "../../src/providers/provider-contract";
import type { OutgoingMessage } from "../../src/providers/types";

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

const msg = (over: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  to: [{ email: "a@x.com" }], cc: [], bcc: [], subject: "Hi", bodyHtml: "<p>hi</p>", ...over,
});

describe("FakeProvider — send/draft behavior", () => {
  it("records sent new messages", async () => {
    const p = new FakeProvider();
    await p.sendNewMessage(msg({ subject: "Test" }));
    expect(p.sentLog).toEqual([{ kind: "new", message: msg({ subject: "Test" }) }]);
  });

  it("records replies with their mode and target id", async () => {
    const p = new FakeProvider();
    await p.replyToMessage("m1", "replyAll", "<p>thanks</p>");
    expect(p.sentLog).toEqual([{ kind: "reply", targetId: "m1", mode: "replyAll", commentHtml: "<p>thanks</p>" }]);
  });

  it("records forwards with recipients", async () => {
    const p = new FakeProvider();
    await p.forwardMessage("m1", "<p>fyi</p>", [{ email: "b@x.com" }]);
    expect(p.sentLog).toEqual([{ kind: "forward", targetId: "m1", commentHtml: "<p>fyi</p>", to: [{ email: "b@x.com" }] }]);
  });

  it("creates, updates, sends, and deletes a draft", async () => {
    const p = new FakeProvider();
    const id = await p.createDraft(msg());
    expect(p.drafts.get(id)).toEqual(msg());

    await p.updateDraft(id, msg({ subject: "Edited" }));
    expect(p.drafts.get(id)).toEqual(msg({ subject: "Edited" }));

    await p.sendDraft(id);
    expect(p.sentLog).toEqual([{ kind: "draft", draftId: id }]);
    expect(p.drafts.has(id)).toBe(false); // sending removes it from the draft map

    const id2 = await p.createDraft(msg());
    await p.deleteDraft(id2);
    expect(p.drafts.has(id2)).toBe(false);
  });

  it("throws on updateDraft/sendDraft/deleteDraft for an unknown id", async () => {
    const p = new FakeProvider();
    await expect(p.updateDraft("nope", msg())).rejects.toThrow();
    await expect(p.sendDraft("nope")).rejects.toThrow();
    await expect(p.deleteDraft("nope")).rejects.toThrow();
  });
});
