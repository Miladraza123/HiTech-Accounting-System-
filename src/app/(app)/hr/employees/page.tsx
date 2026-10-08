import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canManageHr, canReadHr } from "@/lib/hrAccess";
import { EMPLOYEE_TYPE_LABELS, formatPay } from "@/lib/hrRules";

const FILTERS = [
  ["active", "Active"],
  ["left", "Left"],
  ["all", "All"],
] as const;

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const user = await getCurrentUser();
  if (!canReadHr(user)) redirect("/");
  const canManage = canManageHr(user);
  const { status = "active", q = "" } = await searchParams;

  const supabase = await createClient();
  let query = supabase.from("hr_employees_current").select("*").order("full_name");
  if (status === "active") query = query.eq("status", "Active");
  else if (status === "left") query = query.eq("status", "Left");
  const term = q.trim().replace(/[%,()]/g, " ");
  if (term) query = query.or(`full_name.ilike.%${term}%,code.ilike.%${term}%,designation.ilike.%${term}%,department.ilike.%${term}%`);
  const { data: employees, error } = await query;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Employees</h1>
          <p className="mt-1 text-sm text-ink-soft">Staff whose attendance is kept here. Pay and rules changes are saved with an effective date.</p>
        </div>
        {canManage && (
          <Link href="/hr/employees/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition">
            + New Employee
          </Link>
        )}
      </div>

      <form className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="status" value={status} />
        <input name="q" defaultValue={q} placeholder="Search name, code, designation…" className="input max-w-xs" />
        <button className="rounded-md border border-line-strong bg-bg px-3 py-1.5 text-sm">Search</button>
        <div className="flex gap-1 ml-auto">
          {FILTERS.map(([v, l]) => (
            <Link
              key={v}
              href={`/hr/employees?status=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`rounded-md px-3 py-1.5 text-xs border ${status === v ? "border-accent text-accent-ink" : "border-line text-ink-soft"}`}
            >
              {l}
            </Link>
          ))}
        </div>
      </form>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error.message}</p>}

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Code</th>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Designation</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-right px-4 py-2.5">Pay</th>
                <th className="text-left px-4 py-2.5">Policy Group</th>
                <th className="text-left px-4 py-2.5">Joined</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {(employees ?? []).map((e) => (
                <tr key={e.id} className="border-t border-line hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <Link href={`/hr/employees/${e.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                      {e.code}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink">{e.full_name}</td>
                  <td className="px-4 py-2.5 text-ink-soft text-xs">
                    {e.designation ?? "—"}
                    {e.department && ` · ${e.department}`}
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft text-xs">
                    {EMPLOYEE_TYPE_LABELS[e.employee_type ?? ""] ?? "—"}
                    {e.has_overrides && <span className="ml-1 rounded bg-surface-2 px-1 text-[10px]">own rules</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular text-ink whitespace-nowrap">{formatPay(e)}</td>
                  <td className="px-4 py-2.5 text-ink-soft text-xs">
                    {e.policy_group_name ?? "—"}
                    {e.next_change_from && (
                      <span className="block text-[10px] text-warn">Change from {e.next_change_from}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft text-xs whitespace-nowrap">{e.join_date ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${e.status === "Active" ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"}`}>
                      {e.status}
                    </span>
                  </td>
                </tr>
              ))}
              {!employees?.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-ink-faint">
                    No employees found.
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
