import type { Address } from "../providers/types";

export interface ComposerFieldProps {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyHtml: string;
  sending: boolean;
  error: string | null;
  onFieldsChange: (patch: Partial<{ to: Address[]; cc: Address[]; bcc: Address[]; subject: string }>) => void;
  onBodyChange: (html: string) => void;
  onSend: () => void;
  onSaveDraft: () => void;
  onDiscard: () => void;
}
