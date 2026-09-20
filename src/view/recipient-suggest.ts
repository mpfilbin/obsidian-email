import type { Contact } from "../providers/types";

export interface RecipientSuggestion {
  name?: string;
  email: string;
}

const lastComma = (text: string) => text.lastIndexOf(",");

export function currentToken(text: string): string {
  return text.slice(lastComma(text) + 1).trim();
}

/** Addresses already committed in the field — everything before the token
 *  being typed — so they aren't suggested twice. */
export function excludedEmails(text: string): string[] {
  const i = lastComma(text);
  if (i < 0) return [];
  return text.slice(0, i).split(",").map((s) => s.trim()).filter((s) => s.includes("@"));
}

/** Replaces the token being typed with `email` and a `", "` separator, ready
 *  for the next recipient. */
export function replaceToken(text: string, email: string): string {
  const i = lastComma(text);
  const head = i < 0 ? "" : `${text.slice(0, i).trimEnd()}, `;
  return `${head}${email}, `;
}

/** Lower is better: 0 = a name word/local-part/email starts with the query,
 *  1 = the query appears somewhere, null = no match. */
function score(c: Contact, email: string, q: string): 0 | 1 | null {
  const names = [c.displayName, c.givenName, c.surname].filter((s): s is string => !!s).map((s) => s.toLowerCase());
  const words = names.flatMap((n) => n.split(/\s+/));
  const e = email.toLowerCase();
  if (words.some((w) => w.startsWith(q)) || names.some((n) => n.startsWith(q)) || e.startsWith(q)) return 0;
  if (names.some((n) => n.includes(q)) || e.includes(q)) return 1;
  return null;
}

export function rankSuggestions(
  contacts: Contact[],
  query: string,
  exclude: string[] = [],
  limit = 8,
): RecipientSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const skip = new Set(exclude.map((e) => e.toLowerCase()));
  const hits: Array<{ s: RecipientSuggestion; score: number; sortName: string }> = [];
  for (const c of contacts) {
    for (const a of c.emails) {
      if (skip.has(a.email.toLowerCase())) continue;
      const sc = score(c, a.email, q);
      if (sc === null) continue;
      hits.push({ s: { name: c.displayName, email: a.email }, score: sc, sortName: c.displayName.toLowerCase() });
    }
  }
  hits.sort((x, y) => x.score - y.score || x.sortName.localeCompare(y.sortName));
  return hits.slice(0, limit).map((h) => h.s);
}
