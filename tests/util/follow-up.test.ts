import { describe, it, expect } from "vitest";
import { describeFollowUp, followUpPresets, formatDateInput, parseDateInput, startOfLocalDay } from "../../src/util/follow-up";

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

describe("date input helpers", () => {
  it("parseDateInput returns that day's local midnight", () => {
    expect(parseDateInput("2026-10-12")).toBe(day(2026, 10, 12));
    expect(parseDateInput(" 2026-01-05 ")).toBe(day(2026, 1, 5));
  });

  it("parseDateInput accepts a past date (it just reads as overdue)", () => {
    expect(parseDateInput("2020-02-29")).toBe(day(2020, 2, 29));
  });

  it("parseDateInput rejects blanks, malformed strings and impossible dates", () => {
    for (const bad of ["", "tomorrow", "2026-1-5", "10/12/2026", "2026-02-30", "2026-13-01", "2026-00-10", "2027-02-29"]) {
      expect(parseDateInput(bad), bad).toBeUndefined();
    }
  });

  it("formatDateInput is the YYYY-MM-DD of the local day and round-trips", () => {
    expect(formatDateInput(at(2026, 10, 7, 23))).toBe("2026-10-07");
    expect(formatDateInput(day(2026, 1, 5))).toBe("2026-01-05");
    expect(parseDateInput(formatDateInput(at(2026, 3, 9)))).toBe(day(2026, 3, 9));
  });
});
