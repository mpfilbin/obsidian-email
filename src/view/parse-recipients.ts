import type { Address } from "../providers/types";

/** Parses a comma-separated address field. Returns `null` if any non-empty
 *  segment is not a plausible address (contains no "@"), so the caller can
 *  reject the input rather than silently drop it. */
export function parseRecipients(raw: string): Address[] | null {
  const segments = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const addresses: Address[] = [];
  for (const s of segments) {
    if (!s.includes("@")) return null;
    addresses.push({ email: s });
  }
  return addresses;
}
