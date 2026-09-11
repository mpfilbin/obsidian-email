import type { MailboxKind } from "../providers/types";

const MAILBOX_ICON: Record<MailboxKind, string> = {
  inbox: "inbox",
  sent: "send",
  drafts: "pencil",
  archive: "archive",
  trash: "trash-2",
  spam: "shield-alert",
  custom: "folder",
};

export function mailboxIcon(kind: MailboxKind): string {
  return MAILBOX_ICON[kind];
}
