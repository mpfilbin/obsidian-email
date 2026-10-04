import { describe, it, expect } from "vitest";
import { describeFollowUp, followUpPresets, startOfLocalDay } from "../../src/util/follow-up";

const at = (y: number, mo: number, d: number, h = 15) => new Date(y, mo - 1, d, h, 30).getTime();
const day = (y: number, mo: number, d: number) => new Date(y, mo - 1, d).getTime();

describe("followUpPresets", () => {
  it("Today / Tomorrow are local-midnight timestamps", () => {
    const [today, tomorrow] = followUpPresets(at(2026, 10, 7)); // Wednesday
    expect(today).toMatchObject({ id: "today", label: "Today", dueDate: day(2026, 10, 7) });
    expect(tomorrow).toMatchObject({ id: "tomorrow", dueDate: day(2026, 10, 8) });
  });

  it("Next week is the coming Monday, from any weekday", () => {
    const nextWeek = (now: number) => followUpPresets(now)[2].dueDate;
    expect(nextWeek(at(2026, 10, 5))).toBe(day(2026, 10, 12)); // Mon -> a week later
    expect(nextWeek(at(2026, 10, 7))).toBe(day(2026, 10, 12)); // Wed
    expect(nextWeek(at(2026, 10, 10))).toBe(day(2026, 10, 12)); // Sat
    expect(nextWeek(at(2026, 10, 11))).toBe(day(2026, 10, 12)); // Sun -> tomorrow
  });

  it("rolls over month ends", () => {
    const [today, tomorrow] = followUpPresets(at(2026, 10, 31));
    expect(startOfLocalDay(today.dueDate)).toBe(day(2026, 10, 31));
    expect(tomorrow.dueDate).toBe(day(2026, 11, 1));
  });
});

describe("describeFollowUp", () => {
  const now = at(2026, 10, 7);
  it("reads today, tomorrow, overdue and later dates", () => {
    expect(describeFollowUp(day(2026, 10, 7), now)).toEqual({ text: "Due today", overdue: false });
    expect(describeFollowUp(day(2026, 10, 8), now)).toEqual({ text: "Due tomorrow", overdue: false });
    expect(describeFollowUp(day(2026, 10, 6), now)).toEqual({ text: "Overdue", overdue: true });
    const later = describeFollowUp(day(2026, 10, 12), now);
    expect(later.overdue).toBe(false);
    expect(later.text).toMatch(/^Due .*12/);
  });
});
