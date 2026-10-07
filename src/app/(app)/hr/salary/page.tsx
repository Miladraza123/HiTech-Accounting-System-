import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, isOwner } from "@/lib/auth";
import { canReadHr } from "@/lib/hrAccess";
import { asRules } from "@/lib/hrRules";
import { NewSalarySheetForm } from "@/components/NewSalarySheetForm";
import { SHEET_STATUS_STYLE, money, sheetLabel } from "@/lib/hrSalary";

export default async function SalarySheetsPage() {
  const user = await getCurrentUser();
  if (!canReadHr(user)) redirect("/");
  const canPrepare = isOwner(user) || hasRole(user, "hr") || hasRole(user, "accounts");

  const supabase = await createClient();
  const [{ data: sheets }, { data: versions }] = await Promise.all([
    supabase.from("hr_salary_sheets").select("*").order("period_from", { ascending: false }).order("created_at", { ascending: false }).limit(200),
    supabase.from("hr_policy_versions").select("rules").order("effective_from", { ascending: false }).limit(1),
  ]);
  const weekStart = asRules(versions?.[0]?.rules).wager_week_start;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Salary Sheets</h1>
        <p className="mt-1 text-sm text-ink-soft">
          A draft can be recalculated as often as needed. Finalising locks the attendance of those days; paying records how it was paid.
        </p>
      </div>
      {canPrepare && <NewSalarySheetForm weekStart={weekStart} />}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Sheet</th>
                <th className="text-left px-4 py-2.5">Kind</th>
                <th className="text-left px-4 py-2.5">Period</th>
                <th className="text-right px-4 py-2.5">Gross</th>
                <th className="text-right px-4 py-2.5">Advance</th>
                <th className="text-right px-4 py-2.5">Net</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {(sheets ?? []).map((s) => (
                <tr key={s.id} className="border-t border-line hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <Link href={`/hr/salary/${s.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                      {s.sheet_no}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-xs">{sheetLabel(s)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {s.period_from} → {s.period_to}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">{money(s.gross_total)}</td>
                  <td className="px-4 py-2.5 text-right tabular">{money(s.advance_total)}</td>
                  <td className="px-4 py-2.5 text-right tabular font-medium">{money(s.net_total)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${SHEET_STATUS_STYLE[s.status] ?? ""}`}>{s.status}</span>
                  </td>
                </tr>
              ))}
              {!sheets?.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                    No salary sheet yet.
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
