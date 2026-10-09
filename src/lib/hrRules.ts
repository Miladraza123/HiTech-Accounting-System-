// Attendance policy rules: the client-safe mirror of the SQL in
// supabase/migrations/20261006150000_phase47_01_hr_attendance_masters.sql.
// The database (fn_hr_validate_rules / fn_hr_check_rule_set) is the
// authority; this file only drives the forms and the read-only summaries.

export type LateMode = "none" | "deduct_minutes" | "count";
export type EarlyMode = "none" | "deduct_minutes";
export type OtRateType = "multiplier" | "fixed_per_hour";
export type WagerPayCycle = "weekly" | "fortnightly" | "monthly";

export type HrRules = {
  shift_start: string;
  shift_end: string;
  working_days: number[];
  break_minutes: number;
  break_paid: boolean;
  late_grace_minutes: number;
  late_mode: LateMode;
  late_count_per_deduction: number;
  late_deduction_days: number;
  half_day_late_after_minutes: number;
  early_grace_minutes: number;
  early_mode: EarlyMode;
  half_day_below_minutes: number;
  absent_below_minutes: number;
  ot_enabled: boolean;
  ot_min_minutes: number;
  ot_rate_type: OtRateType;
  ot_rate: number;
  sandwich_rule: boolean;
  wager_pay_cycle: WagerPayCycle;
  wager_week_start: number;
  paid_leaves_per_month: number;
};

export type RuleKey = keyof HrRules;

/** Same values as fn_hr_default_rules(). */
export const DEFAULT_RULES: HrRules = {
  shift_start: "09:00",
  shift_end: "18:00",
  working_days: [1, 2, 3, 4, 5, 6],
  break_minutes: 60,
  break_paid: false,
  late_grace_minutes: 10,
  late_mode: "count",
  late_count_per_deduction: 3,
  late_deduction_days: 0.5,
  half_day_late_after_minutes: 120,
  early_grace_minutes: 10,
  early_mode: "deduct_minutes",
  half_day_below_minutes: 240,
  absent_below_minutes: 120,
  ot_enabled: false,
  ot_min_minutes: 30,
  ot_rate_type: "multiplier",
  ot_rate: 1.5,
  sandwich_rule: false,
  wager_pay_cycle: "weekly",
  wager_week_start: 1,
  paid_leaves_per_month: 1,
};

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const RULE_LABELS: Record<RuleKey, string> = {
  shift_start: "Shift start",
  shift_end: "Shift end",
  working_days: "Working days",
  break_minutes: "Break (minutes)",
  break_paid: "Break is paid",
  late_grace_minutes: "Late grace (minutes)",
  late_mode: "Late policy",
  late_count_per_deduction: "Lates per deduction",
  late_deduction_days: "Days deducted",
  half_day_late_after_minutes: "Half day if late more than (minutes)",
  early_grace_minutes: "Early leaving grace (minutes)",
  early_mode: "Early leaving policy",
  half_day_below_minutes: "Half day if worked less than (minutes)",
  absent_below_minutes: "Absent if worked less than (minutes)",
  ot_enabled: "Overtime",
  ot_min_minutes: "Overtime counts after (minutes)",
  ot_rate_type: "Overtime rate type",
  ot_rate: "Overtime rate",
  sandwich_rule: "Sandwich rule",
  wager_pay_cycle: "Daily wager pay cycle",
  wager_week_start: "Pay week starts on",
  paid_leaves_per_month: "Paid leaves per month",
};

export const LATE_MODE_LABELS: Record<LateMode, string> = {
  none: "Ignore late arrival",
  deduct_minutes: "Cut pay for late minutes",
  count: "Every N lates = deduct days",
};

export const EARLY_MODE_LABELS: Record<EarlyMode, string> = {
  none: "Ignore early leaving",
  deduct_minutes: "Cut pay for early minutes",
};

export const PAY_CYCLE_LABELS: Record<WagerPayCycle, string> = {
  weekly: "Weekly",
  fortnightly: "Every 2 weeks",
  monthly: "Monthly",
};

/** Fills any missing key from the defaults (a stored version is always full; this is a safety net). */
export function asRules(value: unknown): HrRules {
  const obj = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<HrRules>) : {};
  return { ...DEFAULT_RULES, ...obj };
}

/** Only the keys present (a per-employee override set). */
export function asOverrides(value: unknown): Partial<HrRules> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Partial<HrRules> = {};
  for (const key of Object.keys(DEFAULT_RULES) as RuleKey[]) {
    if (key in (value as object)) (out as Record<string, unknown>)[key] = (value as Record<string, unknown>)[key];
  }
  return out;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Shift length in minutes; an end before the start is a night shift. */
export function shiftMinutes(rules: Pick<HrRules, "shift_start" | "shift_end">): number {
  const s = toMinutes(rules.shift_start);
  const e = toMinutes(rules.shift_end);
  if (s === e) return 0;
  return e > s ? e - s : e + 1440 - s;
}

/** Paid minutes in a full normal day (shift minus an unpaid break). */
export function paidShiftMinutes(rules: HrRules): number {
  return shiftMinutes(rules) - (rules.break_paid ? 0 : rules.break_minutes);
}

/** Same checks as fn_hr_check_rule_set, so the form can warn before saving. */
export function ruleSetProblems(rules: HrRules): string[] {
  const problems: string[] = [];
  const shift = shiftMinutes(rules);
  if (shift === 0) problems.push("Shift start and end cannot be the same time.");
  else if (rules.break_minutes >= shift) problems.push(`Break (${rules.break_minutes} min) must be shorter than the shift (${shift} min).`);
  if (
    rules.absent_below_minutes > 0 &&
    rules.half_day_below_minutes > 0 &&
    rules.absent_below_minutes > rules.half_day_below_minutes
  ) {
    problems.push('"Absent if worked less than" cannot be more than "Half day if worked less than".');
  }
  if (rules.working_days.length === 0) problems.push("Pick at least one working day.");
  return problems;
}

export function formatWorkingDays(days: number[]): string {
  if (days.length === 7) return "All days";
  return [...days].sort((a, b) => a - b).map((d) => WEEKDAYS[d]).join(", ");
}

/** One-line human text for a single rule value. */
export function formatRuleValue(key: RuleKey, rules: Partial<HrRules>): string {
  const v = rules[key];
  if (v === undefined) return "—";
  switch (key) {
    case "working_days":
      return formatWorkingDays(v as number[]);
    case "break_paid":
    case "ot_enabled":
    case "sandwich_rule":
      return v ? "On" : "Off";
    case "late_mode":
      return LATE_MODE_LABELS[v as LateMode] ?? String(v);
    case "early_mode":
      return EARLY_MODE_LABELS[v as EarlyMode] ?? String(v);
    case "ot_rate_type":
      return v === "multiplier" ? "× normal rate" : "Fixed per hour";
    case "wager_pay_cycle":
      return PAY_CYCLE_LABELS[v as WagerPayCycle] ?? String(v);
    case "wager_week_start":
      return WEEKDAYS[v as number] ?? String(v);
    case "half_day_late_after_minutes":
    case "half_day_below_minutes":
    case "absent_below_minutes":
      return v === 0 ? "Off" : `${v} min`;
    default:
      return String(v);
  }
}

/** Short summary lines for a full rule set (policy cards and history). */
export function summarizeRules(r: HrRules): string[] {
  const lines = [
    `${r.shift_start}–${r.shift_end} (${formatWorkingDays(r.working_days)}), break ${r.break_minutes} min ${r.break_paid ? "paid" : "unpaid"}`,
  ];
  if (r.late_mode === "none") lines.push("Late: ignored");
  else if (r.late_mode === "deduct_minutes") lines.push(`Late: grace ${r.late_grace_minutes} min, then late minutes cut`);
  else lines.push(`Late: grace ${r.late_grace_minutes} min, every ${r.late_count_per_deduction} lates = ${r.late_deduction_days} day cut`);
  if (r.half_day_late_after_minutes > 0) lines.push(`Late more than ${r.half_day_late_after_minutes} min = half day`);
  lines.push(r.early_mode === "none" ? "Early leaving: ignored" : `Early leaving: grace ${r.early_grace_minutes} min, then minutes cut`);
  const short: string[] = [];
  if (r.half_day_below_minutes > 0) short.push(`< ${r.half_day_below_minutes} min = half day`);
  if (r.absent_below_minutes > 0) short.push(`< ${r.absent_below_minutes} min = absent`);
  if (short.length) lines.push(`Worked ${short.join(", ")}`);
  lines.push(
    r.ot_enabled
      ? `Overtime after ${r.ot_min_minutes} min at ${r.ot_rate_type === "multiplier" ? `${r.ot_rate}× rate` : `Rs ${r.ot_rate}/hour`}`
      : "Overtime: off"
  );
  lines.push(`Sandwich rule: ${r.sandwich_rule ? "on" : "off"}`);
  lines.push(`Wagers paid ${PAY_CYCLE_LABELS[r.wager_pay_cycle].toLowerCase()}${r.wager_pay_cycle === "monthly" ? "" : ` (from ${WEEKDAYS[r.wager_week_start]})`}`);
  lines.push(`Paid leaves: ${r.paid_leaves_per_month} days/month`);
  return lines;
}

export const EMPLOYEE_TYPE_LABELS: Record<string, string> = {
  permanent: "Permanent",
  daily_wager: "Daily wager",
};

export function formatPay(t: {
  employee_type: string | null;
  monthly_salary: number | null;
  wage_basis: string | null;
  wage_rate: number | null;
}): string {
  if (t.employee_type === "permanent") return `Rs\u00a0${Number(t.monthly_salary ?? 0).toLocaleString()} / month`;
  if (t.employee_type === "daily_wager") {
    return t.wage_basis === "per_minute"
      ? `Rs\u00a0${Number(t.wage_rate ?? 0).toLocaleString()} / minute`
      : `Rs\u00a0${Number(t.wage_rate ?? 0).toLocaleString()} / day`;
  }
  return "—";
}
