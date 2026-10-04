/** Date helpers for follow-up flags. Due dates are the chosen day's LOCAL
 *  midnight as epoch ms, so "Today" means the user's today. */

export interface FollowUpPreset {
  id: "today" | "tomorrow" | "next-week";
  label: string;
  dueDate: number;
}

export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addDays(ts: number, days: number): number {
  const d = new Date(startOfLocalDay(ts));
  d.setDate(d.getDate() + days); // calendar arithmetic, so DST shifts can't skip a day
  return d.getTime();
}

/** Today, Tomorrow, and next Monday (Outlook's "Next week"). */
export function followUpPresets(now: number): FollowUpPreset[] {
  const dow = new Date(now).getDay(); // 0 = Sunday
  const untilMonday = (8 - dow) % 7 || 7;
  return [
    { id: "today", label: "Today", dueDate: startOfLocalDay(now) },
    { id: "tomorrow", label: "Tomorrow", dueDate: addDays(now, 1) },
    { id: "next-week", label: "Next week", dueDate: addDays(now, untilMonday) },
  ];
}

/** How a due date reads on a row: "Due today", "Due tomorrow", "Due Mon, Oct 12"
 *  or "Overdue". */
export function describeFollowUp(due: number, now: number): { text: string; overdue: boolean } {
  const days = Math.round((startOfLocalDay(due) - startOfLocalDay(now)) / 86_400_000);
  if (days < 0) return { text: "Overdue", overdue: true };
  if (days === 0) return { text: "Due today", overdue: false };
  if (days === 1) return { text: "Due tomorrow", overdue: false };
  const day = new Date(due).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return { text: `Due ${day}`, overdue: false };
}

/** `YYYY-MM-DD` (an `<input type="date">` value) for a timestamp's local day. */
export function formatDateInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses a `YYYY-MM-DD` value to that day's local midnight, or undefined when
 *  it isn't a real calendar date (blank, malformed, or e.g. 2026-02-30). */
export function parseDateInput(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return undefined;
  return date.getTime();
}
