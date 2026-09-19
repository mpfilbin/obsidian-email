import type { Address, OutgoingAttachment } from "../providers/types";

export interface ComposerFieldProps {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyHtml: string;
  attachments: OutgoingAttachment[];
  sending: boolean;
  error: string | null;
  onFieldsChange: (patch: Partial<{ to: Address[]; cc: Address[]; bcc: Address[]; subject: string }>) => void;
  onBodyChange: (html: string) => void;
  onRemoveAttachment: (index: number) => void;
}
