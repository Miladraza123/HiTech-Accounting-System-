import { describe, it, expect } from "vitest";
import { describeRecurrence, formatTime, isDueNow, karachiNow, nextOccurrence, occursOn, type RecurrenceRule } from "./recurringTasks";

const rule = (r: Partial<RecurrenceRule> & { frequency: RecurrenceRule["frequency"] }): RecurrenceRule => ({
  weekdays: [],
  month_day: null,
  month: null,
  due_time: null,
  ...r,
});

describe("occursOn", () => {
  it("daily is every day", () => {
    expect(occursOn(rule({ frequency: "daily" }), "2026-11-09")).toBe(true);
  });
  it("weekly uses the weekdays (0 = Sunday)", () => {
    const r = rule({ frequency: "weekly", weekdays: [1, 3] });
    expect(occursOn(r, "2026-11-09")).toBe(true); // Monday
    expect(occursOn(r, "2026-11-10")).toBe(false); // Tuesday
    expect(occursOn(r, "2026-11-11")).toBe(true); // Wednesday
  });
  it("monthly on the 31st runs on the last day of shorter months", () => {
    const r = rule({ frequency: "monthly", month_day: 31 });
    expect(occursOn(r, "2027-02-28")).toBe(true);
    expect(occursOn(r, "2027-02-27")).toBe(false);
    expect(occursOn(r, "2026-04-30")).toBe(true);
    expect(occursOn(r, "2026-04-29")).toBe(false);
    expect(occursOn(r, "2028-02-29")).toBe(true); // leap year
    expect(occursOn(r, "2026-12-31")).toBe(true);
  });
  it("monthly on the 1st", () => {
    const r = rule({ frequency: "monthly", month_day: 1 });
    expect(occursOn(r, "2026-12-01")).toBe(true);
    expect(occursOn(r, "2026-12-02")).toBe(false);
  });
  it("yearly needs the month and the day (29 Feb runs on 28 Feb in a common year)", () => {
    const r = rule({ frequency: "yearly", month: 2, month_day: 29 });
    expect(occursOn(r, "2027-02-28")).toBe(true);
    expect(occursOn(r, "2028-02-29")).toBe(true);
    expect(occursOn(r, "2028-02-28")).toBe(false);
    expect(occursOn(r, "2027-03-01")).toBe(false);
  });
});

describe("nextOccurrence", () => {
  it("includes today and finds the next matching day", () => {
    const monthly = rule({ frequency: "monthly", month_day: 1 });
    expect(nextOccurrence(monthly, "2026-11-09")).toBe("2026-12-01");
    expect(nextOccurrence(monthly, "2026-12-01")).toBe("2026-12-01");
    expect(nextOccurrence(rule({ frequency: "weekly", weekdays: [1] }), "2026-11-10")).toBe("2026-11-16");
  });
});

describe("describeRecurrence / formatTime", () => {
  it("describes each kind in English", () => {
    expect(describeRecurrence(rule({ frequency: "daily", due_time: "09:00:00" }))).toBe("Every day at 9:00 AM");
    expect(describeRecurrence(rule({ frequency: "weekly", weekdays: [3, 1], due_time: "17:30" }))).toBe("Every Mon, Wed at 5:30 PM");
    expect(describeRecurrence(rule({ frequency: "monthly", month_day: 1 }))).toBe("Every month on the 1st");
    expect(describeRecurrence(rule({ frequency: "monthly", month_day: 22 }))).toBe("Every month on the 22nd");
    expect(describeRecurrence(rule({ frequency: "monthly", month_day: 13 }))).toBe("Every month on the 13th");
    expect(describeRecurrence(rule({ frequency: "yearly", month: 1, month_day: 15 }))).toBe("Every year on 15 Jan");
  });
  it("formats the time of day, and nothing for no time", () => {
    expect(formatTime("00:05")).toBe("12:05 AM");
    expect(formatTime("12:00:00")).toBe("12:00 PM");
    expect(formatTime(null)).toBe("");
  });
});

describe("isDueNow / karachiNow", () => {
  it("is due now only for today's task whose time has come", () => {
    expect(isDueNow({ due_date: "2026-11-09", due_time: "09:00:00" }, "2026-11-09", "09:00")).toBe(true);
    expect(isDueNow({ due_date: "2026-11-09", due_time: "09:30:00" }, "2026-11-09", "09:00")).toBe(false);
    expect(isDueNow({ due_date: "2026-11-09", due_time: null }, "2026-11-09", "23:59")).toBe(false);
    expect(isDueNow({ due_date: "2026-11-08", due_time: "09:00" }, "2026-11-09", "10:00")).toBe(false);
  });
  it("reads the date and time in Karachi (UTC+5)", () => {
    expect(karachiNow(new Date("2026-11-09T20:30:00Z"))).toEqual({ date: "2026-11-10", time: "01:30" });
  });
});
