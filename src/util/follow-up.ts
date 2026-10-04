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
