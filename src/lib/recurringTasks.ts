// Recurring Tasks: the repeat rule as the app shows it. The database (fn_recurrence_hits) decides which
// days a rule really falls on and makes the tasks; occursOn() below is the same rule in TypeScript, used only
// to describe a rule and to show "next due" on the Recurring Tasks page. Dates are plain "YYYY-MM-DD" strings.

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

export const FREQUENCY_LABELS: Record<Frequency, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type RecurrenceRule = {
  frequency: Frequency;
  /** Weekly: 0 = Sunday ... 6 = Saturday. */
  weekdays: number[];
  /** Monthly and yearly: 1 to 31. A day the month does not have runs on the month's last day. */
  month_day: number | null;
  /** Yearly: 1 to 12. */
  month: number | null;
  /** "HH:MM" or "HH:MM:SS", or null for no time. */
  due_time: string | null;
};

const pad = (n: number) => String(n).padStart(2, "0");

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOf(date: string): number {
  const { y, m, d } = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Does the rule fall on this date? Same rule as fn_recurrence_hits in the database. */
export function occursOn(rule: RecurrenceRule, date: string): boolean {
  const { y, m, d } = parts(date);
  switch (rule.frequency) {
    case "daily":
      return true;
    case "weekly":
      return rule.weekdays.includes(weekdayOf(date));
    case "monthly":
      return rule.month_day !== null && d === Math.min(rule.month_day, lastDayOfMonth(y, m));
    case "yearly":
      return rule.month === m && rule.month_day !== null && d === Math.min(rule.month_day, lastDayOfMonth(y, m));
    default:
      return false;
  }
}

/** The first date on or after `from` the rule falls on (searching up to about 3 years), or null. */
export function nextOccurrence(rule: RecurrenceRule, from: string, limit = 1100): string | null {
  for (let i = 0; i <= limit; i++) {
    const d = addDays(from, i);
    if (occursOn(rule, d)) return d;
  }
  return null;
}

/** "09:00" or "17:30:00" as "9:00 AM" / "5:30 PM"; empty for no time. */
export function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}

const ordinal = (n: number) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10] ?? "th"}`;
};

/** "Every day at 9:00 AM", "Every Mon, Wed at 5:30 PM", "Every month on the 1st", "Every year on 1 Jan". */
export function describeRecurrence(rule: RecurrenceRule): string {
  const at = rule.due_time ? ` at ${formatTime(rule.due_time)}` : "";
  switch (rule.frequency) {
    case "daily":
      return `Every day${at}`;
    case "weekly":
      return `Every ${[...rule.weekdays].sort((a, b) => a - b).map((w) => WEEKDAY_LABELS[w]).join(", ")}${at}`;
    case "monthly":
      return `Every month on the ${ordinal(rule.month_day ?? 1)}${at}`;
    case "yearly":
      return `Every year on ${rule.month_day ?? 1} ${MONTH_LABELS[(rule.month ?? 1) - 1]}${at}`;
  }
}

/** Today's date and the time of day ("HH:MM") in Karachi. */
export function karachiNow(now: Date = new Date()): { date: string; time: string } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** A task due today whose time has come (a task with no time is "due today", not "due now"). */
export function isDueNow(task: { due_date: string | null; due_time: string | null }, nowDate: string, nowTime: string): boolean {
  return task.due_date === nowDate && !!task.due_time && task.due_time.slice(0, 5) <= nowTime;
}
