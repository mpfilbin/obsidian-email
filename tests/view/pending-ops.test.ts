import { describe, it, expect } from "vitest";
import {
  describeCompletedOp, describePendingOps, pendingMessageIds, pendingThreadIds, type PendingOp,
} from "../../src/view/pending-ops";

function op(over: Partial<PendingOp> = {}): PendingOp {
  return { id: "op1", accountId: "a1", pastTense: "Deleted", threadIds: ["t1"], messageIds: ["m1"], total: 1, done: 0, ...over };
}

describe("pendingThreadIds / pendingMessageIds", () => {
  it("collect the ids of every op in the active account", () => {
    const state = {
      activeAccountId: "a1",
      pendingOps: [op({ threadIds: ["t1", "t2"], messageIds: ["m1", "m2"] }), op({ id: "op2", threadIds: ["t3"], messageIds: ["m3"] })],
    };
    expect([...pendingThreadIds(state)].sort()).toEqual(["t1", "t2", "t3"]);
    expect([...pendingMessageIds(state)].sort()).toEqual(["m1", "m2", "m3"]);
  });

  it("ignore ops that belong to another account", () => {
    const state = { activeAccountId: "a2", pendingOps: [op()] };
    expect(pendingThreadIds(state).size).toBe(0);
    expect(pendingMessageIds(state).size).toBe(0);
  });

  it("are empty when nothing is running or no account is active", () => {
    expect(pendingThreadIds({ activeAccountId: "a1", pendingOps: [] }).size).toBe(0);
    expect(pendingThreadIds({ activeAccountId: null, pendingOps: [op()] }).size).toBe(0);
  });
});

describe("describePendingOps", () => {
  it("is empty without ops", () => expect(describePendingOps([])).toBe(""));

  it("shows no counter for a single message", () => {
    expect(describePendingOps([op()])).toBe("Deleting…");
    expect(describePendingOps([op({ pastTense: "Archived" })])).toBe("Archiving…");
  });

  it("counts messages with progress for one operation", () => {
    expect(describePendingOps([op({ total: 12, done: 7 })])).toBe("Deleting 12 messages… 7/12");
  });

  it("names the destination of a lone move", () => {
    expect(describePendingOps([op({ pastTense: "Moved", destinationLabel: "Archive", total: 12, done: 7 })]))
      .toBe("Moving 12 messages to Archive… 7/12");
    expect(describePendingOps([op({ pastTense: "Moved", destinationLabel: "Archive" })])).toBe("Moving to Archive…");
  });

  it("sums operations that share a verb, without a destination", () => {
    expect(describePendingOps([
      op({ pastTense: "Moved", destinationLabel: "Archive", total: 12, done: 5 }),
      op({ id: "op2", pastTense: "Moved", destinationLabel: "Sent", total: 8, done: 4 }),
    ])).toBe("Moving 20 messages… 9/20");
  });

  it("falls back to a generic line for mixed verbs", () => {
    expect(describePendingOps([op({ total: 12, done: 5 }), op({ id: "op2", pastTense: "Archived", total: 8, done: 4 })]))
      .toBe("Working on 2 operations… 9/20");
  });
});

describe("describeCompletedOp", () => {
  it("uses singular and plural, and the destination for a move", () => {
    expect(describeCompletedOp({ pastTense: "Deleted", total: 1 })).toBe("Deleted 1 message");
    expect(describeCompletedOp({ pastTense: "Archived", total: 3 })).toBe("Archived 3 messages");
    expect(describeCompletedOp({ pastTense: "Moved", total: 12, destinationLabel: "Archive" })).toBe("Moved 12 messages to Archive");
  });
});
