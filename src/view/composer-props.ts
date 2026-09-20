import type { Address, OutgoingAttachment } from "../providers/types";
import type { RecipientSuggestion } from "./recipient-suggest";

export interface ComposerFieldProps {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyHtml: string;
  attachments: OutgoingAttachment[];
  error: string | null;
  /** Contact autocomplete for the recipient fields; absent → no dropdown. */
  suggest?: (token: string, exclude: string[]) => RecipientSuggestion[];
  onFieldsChange: (patch: Partial<{ to: Address[]; cc: Address[]; bcc: Address[]; subject: string }>) => void;
  onBodyChange: (html: string) => void;
  onRemoveAttachment: (index: number) => void;
}
