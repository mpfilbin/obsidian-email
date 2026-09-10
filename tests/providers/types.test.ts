import { describe, it, expect } from "vitest";
import { AuthError, ProviderError } from "../../src/providers/types";
import type { MessageSummary, SyncCursor } from "../../src/providers/types";

describe("types", () => {
  it("AuthError and ProviderError carry their fields", () => {
    expect(new AuthError("x").name).toBe("AuthError");
    const p = new ProviderError("y", 503, true);
    expect(p.status).toBe(503);
    expect(p.retryable).toBe(true);
  });

  it("SyncCursor discriminates on kind", () => {
    const c: SyncCursor = { kind: "gmail", historyId: "1" };
    expect(c.kind === "gmail" && c.historyId).toBe("1");
  });

  it("MessageSummary is structurally usable", () => {
    const m: MessageSummary = {
      id: "1", threadId: "t1", mailboxIds: ["INBOX"],
      from: { email: "a@b.com" }, to: [], cc: [],
      subject: "hi", snippet: "...", date: 0,
      unread: true, hasAttachments: false, flagged: false,
    };
    expect(m.id).toBe("1");
  });
});
