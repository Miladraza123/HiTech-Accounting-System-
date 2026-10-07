import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canReadHr } from "@/lib/hrAccess";
import { karachiToday } from "@/lib/karachiTime";
import { days } from "@/lib/hrSalary";

export default async function LeaveBalancePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await getCurrentUser();
  if (!canReadHr(user)) redirect("/");
  const { year: raw } = await searchParams;
  const year = /^\d{4}$/.test(raw ?? "") ? Number(raw) : Number(karachiToday().slice(0, 4));

  const supabase = await createClient();
  const [{ data: rows, error }, { data: employees }] = await Promise.all([
    supabase.rpc("fn_hr_leave_balance", { p_year: year }),
    supabase.from("hr_employees_current").select("id, code, full_name, employee_type, status"),
  ]);
  const byId = new Map((employees ?? []).map((e) => [e.id, e]));
  const list = (rows ?? [])
    .map((r) => ({ ...r, emp: byId.get(r.employee_id) }))
    .filter((r) => r.emp?.employee_type === "permanent" || Number(r.used) > 0)
    .sort((a, b) => (a.emp?.full_name ?? "").localeCompare(b.emp?.full_name ?? ""));

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Paid Leave Balance {year}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Quota comes from the policy group (or the employee&apos;s own rules). Paid-type leave beyond the quota is paid as unpaid leave.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link href={`?year=${year - 1}`} className="rounded-md border border-line px-2 py-1">
            ← {year - 1}
          </Link>
          <Link href={`?year=${year + 1}`} className="rounded-md border border-line px-2 py-1">
            {year + 1} →
          </Link>
        </div>
      </div>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error.message}</p>}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="text-left px-4 py-2.5">Employee</th>
              <th className="text-right px-4 py-2.5">Quota</th>
              <th className="text-right px-4 py-2.5">Used (paid)</th>
              <th className="text-right px-4 py-2.5">Over quota (unpaid)</th>
              <th className="text-right px-4 py-2.5">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.employee_id} className="border-t border-line">
                <td className="px-4 py-2.5">
                  <Link href={`/hr/employees/${r.employee_id}`} className="hover:underline">
                    {r.emp?.full_name}
                  </Link>{" "}
                  <span className="font-mono text-xs text-ink-faint">{r.emp?.code}</span>
                  {r.emp?.status === "Left" && <span className="ml-1 text-[10px] text-ink-faint">(left)</span>}
                </td>
                <td className="px-4 py-2.5 text-right tabular">{days(r.quota)}</td>
                <td className="px-4 py-2.5 text-right tabular">{days(r.used)}</td>
                <td className="px-4 py-2.5 text-right tabular">{days(r.unpaid_extra)}</td>
                <td className="px-4 py-2.5 text-right tabular font-medium">{days(r.remaining)}</td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                  No permanent employees in {year}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
