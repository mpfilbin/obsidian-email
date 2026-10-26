/** How long an operation may run before the progress toast appears — and
 *  before a success notice is worth sending. Quick actions need neither: the
 *  rows disappearing is the confirmation. */
export const OPERATION_TOAST_DELAY_MS = 300;

export type OpPastTense = "Deleted" | "Archived" | "Moved";

const PROGRESS_VERB: Record<OpPastTense, string> = { Deleted: "Deleting", Archived: "Archiving", Moved: "Moving" };

/** A delete, archive or move that has been sent to the server and not yet
 *  settled. Rows and messages it names are shown as pending. */
export interface PendingOp {
  /** Unique per run (a counter), not a message or thread id. */
  id: string;
  accountId: string;
  pastTense: OpPastTense;
  /** Moves only: the target mailbox's name. */
  destinationLabel?: string;
  /** Rows to mark pending — empty for a single-message op. */
  threadIds: string[];
  /** Every message the op will touch. */
  messageIds: string[];
  total: number;
  /** Settled so far, success or failure. */
  done: number;
}

interface PendingSource {
  pendingOps: PendingOp[];
  activeAccountId: string | null;
}

/** Threads being acted on in the active account. An op started before an
 *  account switch keeps running but must not mark the new account's rows. */
export function pendingThreadIds(state: PendingSource): Set<string> {
  const out = new Set<string>();
  for (const op of state.pendingOps) if (op.accountId === state.activeAccountId) for (const id of op.threadIds) out.add(id);
  return out;
}

/** Messages being acted on in the active account. */
export function pendingMessageIds(state: PendingSource): Set<string> {
  const out = new Set<string>();
  for (const op of state.pendingOps) if (op.accountId === state.activeAccountId) for (const id of op.messageIds) out.add(id);
  return out;
}

/** The progress toast's text. Progress counts messages — the unit of server
 *  work — even though the list shows threads. */
export function describePendingOps(ops: readonly PendingOp[]): string {
  if (ops.length === 0) return "";
  const total = ops.reduce((n, o) => n + o.total, 0);
  const done = ops.reduce((n, o) => n + o.done, 0);
  if (new Set(ops.map((o) => o.pastTense)).size > 1) return `Working on ${ops.length} operations… ${done}/${total}`;
  const verb = PROGRESS_VERB[ops[0].pastTense];
  const dest = ops.length === 1 && ops[0].destinationLabel ? ` to ${ops[0].destinationLabel}` : "";
  if (total === 1) return `${verb}${dest}…`;
  return `${verb} ${total} messages${dest}… ${done}/${total}`;
}

/** The notice for an operation that finished cleanly after a noticeable wait. */
export function describeCompletedOp(op: Pick<PendingOp, "pastTense" | "total" | "destinationLabel">): string {
  const dest = op.destinationLabel ? ` to ${op.destinationLabel}` : "";
  return `${op.pastTense} ${op.total} ${op.total === 1 ? "message" : "messages"}${dest}`;
}
