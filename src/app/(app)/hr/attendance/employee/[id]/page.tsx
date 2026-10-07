import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canReadHr } from "@/lib/hrAccess";
import { karachiToday } from "@/lib/karachiTime";
import { isMonth, monthRange, shiftMonth } from "@/lib/hrMonth";
import { STATUS_LABELS, WARNING_LABELS, minutesLabel, type DayCalc } from "@/lib/hrDayCalc";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function EmployeeMonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await getCurrentUser();
  if (!canReadHr(user)) redirect("/");
  const { id } = await params;
  const { month: raw } = await searchParams;
  const month = isMonth(raw) ? raw : karachiToday().slice(0, 7);
  const { from, to } = monthRange(month);

  const supabase = await createClient();
  const [{ data: emp }, { data: days, error }, { data: leaveTypes }] = await Promise.all([
    supabase.from("hr_employees").select("id, code, full_name").eq("id", id).maybeSingle(),
    supabase.rpc("fn_hr_day_results", { p_from: from, p_to: to, p_employee_ids: [id] }),
    supabase.from("hr_leave_types").select("id, name"),
  ]);
  if (!emp) notFound();
  const ltName = new Map((leaveTypes ?? []).map((t) => [t.id, t.name]));

  const totals = { P: 0, HD: 0, HL: 0, A: 0, L: 0, NE: 0, late: 0, ot: 0, worked: 0 };
  for (const d of days ?? []) {
    const c = d.calc as unknown as DayCalc;
    if (c.status in totals) totals[c.status as "P"] += 1;
    if (c.late_counted) totals.late += 1;
    totals.ot += c.ot + c.offday_ot;
    totals.worked += c.net;
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/hr/employees/${emp.id}`} className="text-xs text-accent-ink underline underline-offset-2">
            ← {emp.full_name}
          </Link>
          <h1 className="mt-2 text-lg font-semibold text-ink">
            Attendance {month} <span className="font-mono text-sm text-ink-faint">{emp.code}</span>
          </h1>
        </div>
        <div className="flex gap-2 text-xs">
          <Link href={`?month=${shiftMonth(month, -1)}`} className="rounded-md border border-line px-2 py-1">
            ← {shiftMonth(month, -1)}
          </Link>
          <Link href={`?month=${shiftMonth(month, 1)}`} className="rounded-md border border-line px-2 py-1">
            {shiftMonth(month, 1)} →
          </Link>
        </div>
      </div>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error.message}</p>}
      <p className="text-sm text-ink-soft">
        Present {totals.P} · Half day {totals.HD} · Half leave {totals.HL} · Absent {totals.A} · Leave {totals.L} · Not entered {totals.NE} · Late {totals.late} · Worked{" "}
        {minutesLabel(totals.worked)} · Overtime {minutesLabel(totals.ot)}
      </p>
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">In / Out</th>
                <th className="text-right px-3 py-2">Worked</th>
                <th className="text-right px-3 py-2">Late</th>
                <th className="text-right px-3 py-2">Early</th>
                <th className="text-right px-3 py-2">OT</th>
                <th className="text-left px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {(days ?? []).map((d) => {
                const c = d.calc as unknown as DayCalc;
                const extras = (d.extra_pairs as { in: string; out: string }[] | null) ?? [];
                return (
                  <tr key={d.work_date} className={`border-t border-line ${d.day_kind !== "work" ? "bg-surface-2/50" : ""}`}>
                    <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">
                      <Link href={`/hr/attendance?date=${d.work_date}`} className="underline underline-offset-2">
                        {d.work_date}
                      </Link>{" "}
                      {WEEKDAY[new Date(`${d.work_date}T00:00:00Z`).getUTCDay()]}
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      {STATUS_LABELS[c.status]}
                      {d.leave_type_id && <span className="text-ink-faint"> ({ltName.get(d.leave_type_id)})</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs">
                      {d.check_in || d.check_out ? `${d.check_in ?? "?"}–${d.check_out ?? "?"}` : ""}
                      {extras.map((p) => `, ${p.in}–${p.out}`).join("")}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular text-xs">{c.net ? minutesLabel(c.net) : ""}</td>
                    <td className="px-3 py-1.5 text-right tabular text-xs">{c.late ? minutesLabel(c.late) : ""}</td>
                    <td className="px-3 py-1.5 text-right tabular text-xs">{c.early ? minutesLabel(c.early) : ""}</td>
                    <td className="px-3 py-1.5 text-right tabular text-xs">{c.ot + c.offday_ot ? minutesLabel(c.ot + c.offday_ot) : ""}</td>
                    <td className="px-3 py-1.5 text-xs text-ink-soft">
                      {[d.note, ...c.warnings.filter((w) => w !== "overtime").map((w) => WARNING_LABELS[w] ?? w)].filter(Boolean).join(" · ")}
                    </td>
                  </tr>
                );
              })}
              {!days?.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-ink-faint">
                    Not employed in this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
