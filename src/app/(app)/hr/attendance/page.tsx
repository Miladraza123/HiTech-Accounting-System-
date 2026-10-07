import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canManageHr, canReadHr } from "@/lib/hrAccess";
import { karachiToday } from "@/lib/karachiTime";
import { AttendanceGrid, type GridEmployee } from "@/components/AttendanceGrid";
import type { DayKind, Mark } from "@/lib/hrDayCalc";

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await getCurrentUser();
  if (!canReadHr(user)) redirect("/");
  const canEdit = canManageHr(user);
  const today = karachiToday();
  const { date: raw } = await searchParams;
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;

  const supabase = await createClient();
  const [{ data: results, error }, { data: employees }, { data: leaveTypes }, { data: holiday }, { data: lockedRows }] = await Promise.all([
    supabase.rpc("fn_hr_day_results", { p_from: date, p_to: date }),
    supabase.from("hr_employees").select("id, code, full_name, designation"),
    supabase.from("hr_leave_types").select("id, name, is_paid").eq("is_active", true).order("name"),
    supabase.from("hr_holidays").select("name").eq("holiday_date", date).maybeSingle(),
    supabase.rpc("fn_hr_locked_employees", { p_date: date }),
  ]);

  const byId = new Map((employees ?? []).map((e) => [e.id, e]));
  const locked = new Set((lockedRows as string[] | null) ?? []);
  const grid: GridEmployee[] = (results ?? [])
    .map((r) => {
      const e = byId.get(r.employee_id);
      return {
        employee_id: r.employee_id,
        code: e?.code ?? "",
        full_name: e?.full_name ?? "",
        designation: e?.designation ?? null,
        day_kind: r.day_kind as DayKind,
        rules: r.rules,
        locked: locked.has(r.employee_id),
        entry: {
          mark: (r.mark as Mark) ?? null,
          check_in: r.check_in,
          check_out: r.check_out,
          extra_pairs: (r.extra_pairs as { in: string; out: string }[] | null) ?? [],
          leave_type_id: r.leave_type_id,
          leave_fraction: r.leave_fraction === null ? null : Number(r.leave_fraction),
          note: r.note,
        },
      };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const weekday = WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Daily Attendance</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {weekday}, {date}
            {holiday && <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-xs text-warn">Holiday: {holiday.name}</span>}
          </p>
        </div>
        <form className="flex items-center gap-2">
          <Link href={`/hr/attendance?date=${shiftDate(date, -1)}`} className="rounded-md border border-line-strong bg-bg px-2 py-1.5 text-sm" aria-label="Previous day">
            ←
          </Link>
          <input type="date" name="date" defaultValue={date} className="input max-w-[10rem]" />
          <button className="rounded-md border border-line-strong bg-bg px-3 py-1.5 text-sm">Go</button>
          <Link href={`/hr/attendance?date=${shiftDate(date, 1)}`} className="rounded-md border border-line-strong bg-bg px-2 py-1.5 text-sm" aria-label="Next day">
            →
          </Link>
          {date !== today && (
            <Link href="/hr/attendance" className="text-xs text-accent-ink underline underline-offset-2">
              Today
            </Link>
          )}
        </form>
      </div>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error.message}</p>}
      <AttendanceGrid key={date} date={date} employees={grid} leaveTypes={leaveTypes ?? []} canEdit={canEdit} isFuture={date > today} />
    </div>
  );
}
