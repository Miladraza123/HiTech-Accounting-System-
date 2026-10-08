import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canReadHr } from "@/lib/hrAccess";
import { karachiToday } from "@/lib/karachiTime";
import { isMonth, monthRange, shiftMonth } from "@/lib/hrMonth";
import { minutesLabel } from "@/lib/hrDayCalc";
import { days } from "@/lib/hrSalary";

const CODE_STYLE: Record<string, string> = {
  P: "text-good",
  W: "text-good",
  "½": "text-warn",
  "½L": "text-warn",
  A: "text-bad font-semibold",
  "?": "text-bad",
  L: "text-accent-ink",
  "-": "text-ink-faint",
  H: "text-ink-faint",
};

export default async function AttendanceRegisterPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await getCurrentUser();
  if (!canReadHr(user)) redirect("/");
  const { month: raw } = await searchParams;
  const month = isMonth(raw) ? raw : karachiToday().slice(0, 7);
  const { from, to } = monthRange(month);
  const dayCount = Number(to.slice(8));

  const supabase = await createClient();
  const [{ data: rows, error }, { data: employees }] = await Promise.all([
    supabase.rpc("fn_hr_register", { p_month: from }),
    supabase.from("hr_employees").select("id, code, full_name"),
  ]);
  const byId = new Map((employees ?? []).map((e) => [e.id, e]));
  const list = (rows ?? [])
    .map((r) => ({ ...r, emp: byId.get(r.employee_id) }))
    .sort((a, b) => (a.emp?.full_name ?? "").localeCompare(b.emp?.full_name ?? ""));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Attendance Register {month}</h1>
          <p className="mt-1 text-xs text-ink-soft">
            P present · ½ half day · A absent · L leave · ½L half leave · W worked on off day · - weekly off · H holiday · ? not entered
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Link href={`?month=${shiftMonth(month, -1)}`} className="rounded-md border border-line px-2 py-1">
            ← {shiftMonth(month, -1)}
          </Link>
          <Link href={`?month=${shiftMonth(month, 1)}`} className="rounded-md border border-line px-2 py-1">
            {shiftMonth(month, 1)} →
          </Link>
          <a href={`/hr/reports/register/export?month=${month}`} className="rounded-md bg-accent px-3 py-1.5 font-medium text-white">
            Excel
          </a>
        </div>
      </div>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error.message}</p>}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead className="bg-surface-2 font-mono text-ink-faint">
              <tr>
                <th className="sticky left-0 bg-surface-2 text-left px-3 py-2 min-w-[11rem]">Employee</th>
                {Array.from({ length: dayCount }, (_, i) => (
                  <th key={i} className="px-1 py-2 text-center w-7">
                    {i + 1}
                  </th>
                ))}
                <th className="px-2 py-2 text-right">P</th>
                <th className="px-2 py-2 text-right">A</th>
                <th className="px-2 py-2 text-right">L</th>
                <th className="px-2 py-2 text-right">Late</th>
                <th className="px-2 py-2 text-right">?</th>
                <th className="px-2 py-2 text-right">OT</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.employee_id} className="border-t border-line">
                  <td className="sticky left-0 bg-surface px-3 py-1.5 whitespace-nowrap">
                    <Link href={`/hr/attendance/employee/${r.employee_id}?month=${month}`} className="hover:underline">
                      {r.emp?.full_name}
                    </Link>{" "}
                    <span className="font-mono text-[10px] text-ink-faint">{r.emp?.code}</span>
                  </td>
                  {(r.codes as string[]).map((c, i) => (
                    <td key={i} className={`px-1 py-1.5 text-center font-mono ${CODE_STYLE[c] ?? ""}`}>
                      {c}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right tabular">{days(r.present)}</td>
                  <td className="px-2 py-1.5 text-right tabular">{days(r.absent)}</td>
                  <td className="px-2 py-1.5 text-right tabular">{days(r.leave)}</td>
                  <td className="px-2 py-1.5 text-right tabular">{r.lates}</td>
                  <td className="px-2 py-1.5 text-right tabular">{r.not_entered}</td>
                  <td className="px-2 py-1.5 text-right tabular whitespace-nowrap">{minutesLabel(r.ot_minutes)}</td>
                </tr>
              ))}
              {!list.length && (
                <tr>
                  <td colSpan={dayCount + 7} className="px-4 py-6 text-center text-ink-faint">
                    No employees in this month.
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
