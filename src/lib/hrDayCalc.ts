// Browser copy of fn_hr_calc_day() in
// supabase/migrations/20261006160000_phase47_02_hr_attendance_entry.sql,
// used only for the live preview in the daily grid. The database result is
// what reports and salary use. hrDayCalc.fixtures.json is run against both
// (hrDayCalc.test.ts here, and the SQL fixture check) so they cannot drift.

import type { HrRules } from "@/lib/hrRules";

export type DayKind = "work" | "off" | "holiday";
export type Mark = "present" | "absent" | "leave" | null;
export type Pair = { in: string | null; out: string | null };

export type DayStatus = "P" | "HD" | "A" | "L" | "HL" | "NE" | "W" | "OFF" | "HOL";

export type DayCalc = {
  status: DayStatus;
  work_value: number;
  leave_value: number;
  worked: number;
  net: number;
  normal: number;
  late: number;
  early: number;
  late_counted: boolean;
  late_cut: number;
  early_cut: number;
  ot: number;
  offday_ot: number;
  break_cut: number;
  warnings: string[];
};

function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function calcDay(
  r: HrRules,
  dayKind: DayKind,
  mark: Mark,
  pairs: Pair[],
  leaveFraction: number | null
): DayCalc {
  const start = toMin(r.shift_start);
  let end = toMin(r.shift_end);
  if (end <= start) end += 1440;
  const shift = end - start;
  const paidShift = shift - (r.break_paid ? 0 : r.break_minutes);
  const anchor = start - 240;
  const mid = start + Math.floor(shift / 2);
  const work = dayKind === "work";
  const offStatus: DayStatus = dayKind === "holiday" ? "HOL" : "OFF";
  const warnings: string[] = [];
  const halfLeave = mark === "leave" && leaveFraction === 0.5;
  let leaveValue = 0;

  const empty = (status: DayStatus): DayCalc => ({
    status,
    work_value: 0,
    leave_value: leaveValue,
    worked: 0,
    net: 0,
    normal: 0,
    late: 0,
    early: 0,
    late_counted: false,
    late_cut: 0,
    early_cut: 0,
    ot: 0,
    offday_ot: 0,
    break_cut: 0,
    warnings,
  });

  if (mark === "leave") {
    if (!work) warnings.push("leave_on_off_day");
    else leaveValue = leaveFraction ?? 1;
  }

  if (mark === null || mark === "absent" || (mark === "leave" && !halfLeave)) {
    if (mark === null && work) warnings.push("not_entered");
    return empty(!work ? offStatus : mark === null ? "NE" : mark === "absent" ? "A" : "L");
  }

  let segs = 0;
  let worked = 0;
  let firstIn: number | null = null;
  let lastOut: number | null = null;
  let singleIn = 0;
  let singleOut = 0;

  pairs.forEach((p, i) => {
    let tin = p.in ? toMin(p.in) : null;
    let tout = p.out ? toMin(p.out) : null;
    if (tin === null && tout === null) return;
    if (i > 0 && (tin === null || tout === null)) {
      warnings.push("incomplete_pair");
      return;
    }
    if (tin === null) {
      warnings.push("missing_in");
      tin = start;
    } else if (tin < anchor) tin += 1440;
    if (tout === null) {
      warnings.push("missing_out");
      tout = end;
    } else if (tout < anchor) tout += 1440;
    if (tout <= tin) tout += 1440;
    segs += 1;
    worked += tout - tin;
    firstIn = firstIn === null ? tin : Math.min(firstIn, tin);
    lastOut = lastOut === null ? tout : Math.max(lastOut, tout);
    singleIn = tin;
    singleOut = tout;
  });

  if (segs === 0) {
    if (halfLeave) return empty(work ? "HL" : offStatus);
    warnings.push("no_times");
    segs = 1;
    worked = shift;
    firstIn = start;
    lastOut = end;
    singleIn = start;
    singleOut = end;
  }

  const breakCut = !r.break_paid && segs === 1 && singleIn <= mid && singleOut >= mid ? Math.min(r.break_minutes, worked) : 0;
  const net = worked - breakCut;
  const late = work ? Math.max(0, (firstIn ?? start) - start) : 0;
  const early = work ? Math.max(0, end - (lastOut ?? end)) : 0;

  let workValue = 1;
  if (r.absent_below_minutes > 0 && net < r.absent_below_minutes) workValue = 0;
  else if (r.half_day_below_minutes > 0 && net < r.half_day_below_minutes) workValue = 0.5;
  else if (r.half_day_late_after_minutes > 0 && late > r.half_day_late_after_minutes) workValue = 0.5;
  if (halfLeave) workValue = Math.min(workValue, 0.5);

  const status: DayStatus = !work ? "W" : halfLeave ? "HL" : workValue === 0 ? "A" : workValue === 0.5 ? "HD" : "P";

  let lateCounted = false;
  let lateCut = 0;
  let earlyCut = 0;
  if (work && workValue === 1 && !halfLeave) {
    if (r.late_mode !== "none" && late > r.late_grace_minutes) {
      lateCounted = true;
      if (r.late_mode === "deduct_minutes") lateCut = late;
    }
    if (r.early_mode === "deduct_minutes" && early > r.early_grace_minutes) earlyCut = early;
  }

  let normal = 0;
  let ot = 0;
  if (workValue > 0) {
    normal = Math.min(net, paidShift);
    if (r.ot_enabled && !halfLeave && net - paidShift > r.ot_min_minutes) ot = net - paidShift;
  }
  const offdayOt = !work && r.ot_enabled && net > r.ot_min_minutes ? net : 0;

  if (lateCounted) warnings.push("late");
  if (work && early > r.early_grace_minutes && workValue === 1) warnings.push("early");
  if (work && workValue < 1 && !halfLeave) warnings.push("short_day");
  if (ot > 0 || offdayOt > 0) warnings.push("overtime");
  if (net > 960) warnings.push("long_day");

  return {
    status,
    work_value: workValue,
    leave_value: leaveValue,
    worked,
    net,
    normal,
    late,
    early,
    late_counted: lateCounted,
    late_cut: lateCut,
    early_cut: earlyCut,
    ot,
    offday_ot: offdayOt,
    break_cut: breakCut,
    warnings,
  };
}

export const STATUS_LABELS: Record<DayStatus, string> = {
  P: "Present",
  HD: "Half day",
  A: "Absent",
  L: "Leave",
  HL: "Half leave",
  NE: "Not entered",
  W: "Worked (off day)",
  OFF: "Weekly off",
  HOL: "Holiday",
};

export const WARNING_LABELS: Record<string, string> = {
  not_entered: "Not entered",
  missing_in: "In time missing (shift start used)",
  missing_out: "Out time missing (shift end used)",
  incomplete_pair: "Extra pair missing a time (ignored)",
  no_times: "No times (counted as a full day)",
  late: "Late",
  early: "Left early",
  short_day: "Short day",
  overtime: "Overtime",
  long_day: "Over 16 hours",
  leave_on_off_day: "Leave on an off day (not counted)",
};

export function minutesLabel(m: number): string {
  if (!m) return "0";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h}h${mm ? ` ${mm}m` : ""}` : `${mm}m`;
}
