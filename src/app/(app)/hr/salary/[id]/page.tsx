import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, isOwner } from "@/lib/auth";
import { canReadHr } from "@/lib/hrAccess";
import { karachiToday } from "@/lib/karachiTime";
import { minutesLabel } from "@/lib/hrDayCalc";
import { EMPLOYEE_TYPE_LABELS } from "@/lib/hrRules";
import { SHEET_STATUS_STYLE, days, money, sheetLabel } from "@/lib/hrSalary";
import { SalarySheetActions } from "@/components/SalarySheetActions";
import { SalaryLineAdjust } from "@/components/SalaryLineAdjust";

export default async function SalarySheetPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!canReadHr(user)) redirect("/");
  const canPrepare = isOwner(user) || hasRole(user, "hr") || hasRole(user, "accounts");
  const canPay = isOwner(user) || hasRole(user, "accounts");
  const { id } = await params;

  const supabase = await createClient();
  const [{ data: sheet }, { data: lines }, { data: settings }, { data: banks }, { data: funds }, { data: balances }] = await Promise.all([
    supabase.from("hr_salary_sheets").select("*").eq("id", id).maybeSingle(),
    supabase.from("hr_salary_lines").select("*, hr_employees(code, full_name, designation)").eq("sheet_id", id),
    supabase.from("hr_settings").select("salary_journal_enabled").maybeSingle(),
    supabase.from("bank_accounts").select("id, account_name").eq("is_active", true).order("account_name"),
    supabase.from("petty_cash_funds").select("id, fund_name").eq("is_active", true).order("fund_name"),
    supabase.from("hr_advance_balances").select("employee_id, outstanding"),
  ]);
  if (!sheet) notFound();

  const jeIds = [sheet.journal_entry_id, sheet.payment_journal_entry_id].filter((x): x is string => !!x);
  const { data: entries } = jeIds.length ? await supabase.from("journal_entries").select("id, entry_no").in("id", jeIds) : { data: [] };
  const entryNo = new Map((entries ?? []).map((e) => [e.id, e.entry_no]));
  const owed = new Map<string, number>();
  for (const b of balances ?? []) owed.set(b.employee_id!, (owed.get(b.employee_id!) ?? 0) + Number(b.outstanding ?? 0));

  type Emp = { code: string; full_name: string; designation: string | null };
  const sorted = [...(lines ?? [])].sort((a, b) =>
    (a.hr_employees as unknown as Emp).full_name.localeCompare((b.hr_employees as unknown as Emp).full_name)
  );
  const editable = sheet.status === "Draft" && canPrepare;
  const sum = (k: "base_pay" | "ot_pay" | "late_deduction" | "early_deduction" | "sandwich_deduction" | "bonus" | "other_deduction") =>
    sorted.reduce((t, l) => t + Number(l[k]), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/hr/salary" className="text-xs text-accent-ink underline underline-offset-2">
            ← Salary Sheets
          </Link>
          <h1 className="mt-2 text-lg font-semibold text-ink">
            {sheet.sheet_no}{" "}
            <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-mono align-middle ${SHEET_STATUS_STYLE[sheet.status] ?? ""}`}>{sheet.status}</span>
          </h1>
          <p className="text-sm text-ink-soft">
            {sheetLabel(sheet)} · {sheet.period_from} → {sheet.period_to}
            {sheet.note && ` · ${sheet.note}`}
          </p>
          <p className="text-xs text-ink-faint">
            {sheet.journal_entry_id && <>Journal {entryNo.get(sheet.journal_entry_id)} · </>}
            {sheet.paid_on && (
              <>
                Paid {sheet.paid_on} ({sheet.payment_source?.replace("_", " ")})
                {sheet.payment_journal_entry_id && <> · Journal {entryNo.get(sheet.payment_journal_entry_id)}</>}
              </>
            )}
            {sheet.cancel_reason && <>Cancelled: {sheet.cancel_reason}</>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-ink-faint">Net to pay</p>
          <p className="text-xl font-semibold tabular text-ink">{money(sheet.net_total)}</p>
          <p className="text-xs text-ink-faint">
            Gross {money(sheet.gross_total)} · Advances back {money(sheet.advance_total)}
          </p>
          <a href={`/hr/salary/${sheet.id}/export`} className="text-xs text-accent-ink underline underline-offset-2">
            Download Excel
          </a>
        </div>
      </div>

      <SalarySheetActions
        sheetId={sheet.id}
        status={sheet.status}
        canPrepare={canPrepare}
        canPay={canPay}
        journalOn={!!settings?.salary_journal_enabled}
        hasJournal={!!sheet.journal_entry_id}
        periodEnded={sheet.period_to <= karachiToday()}
        bankAccounts={banks ?? []}
        pettyCashFunds={funds ?? []}
      />

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-[11px] font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Employee</th>
                <th className="text-right px-3 py-2" title="Working days / present / absent / paid leave / unpaid leave">
                  Days W/P/A/PL/UL
                </th>
                <th className="text-right px-3 py-2">Late · OT</th>
                <th className="text-right px-3 py-2">Base</th>
                <th className="text-right px-3 py-2">OT pay</th>
                <th className="text-right px-3 py-2" title="Late + early leaving + sandwich">
                  Cuts
                </th>
                <th className="text-right px-3 py-2">Bonus / other</th>
                <th className="text-right px-3 py-2">Gross</th>
                <th className="text-right px-3 py-2">Advance</th>
                <th className="text-right px-3 py-2">Net</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => {
                const e = l.hr_employees as unknown as Emp;
                const cuts = Number(l.late_deduction) + Number(l.early_deduction) + Number(l.sandwich_deduction);
                return (
                  <tr key={l.id} className="border-t border-line align-top">
                    <td className="px-3 py-2">
                      <Link href={`/hr/attendance/employee/${l.employee_id}?month=${sheet.period_from.slice(0, 7)}`} className="text-ink underline-offset-2 hover:underline">
                        {e.full_name}
                      </Link>
                      <p className="text-[11px] text-ink-faint">
                        <span className="font-mono">{e.code}</span> · {EMPLOYEE_TYPE_LABELS[l.employee_type]}
                        {l.pay_basis === "per_minute" ? ` · Rs ${Number(l.rate)}/min` : l.pay_basis === "per_day" ? ` · Rs ${Number(l.rate).toLocaleString()}/day` : ` · ${money(l.rate)}/month`}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tabular text-xs whitespace-nowrap">
                      {days(l.working_days)}/{days(l.present_days)}/{days(l.absent_days)}/{days(l.paid_leave_days)}/{days(l.unpaid_leave_days)}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-xs whitespace-nowrap">
                      {l.late_count} · {minutesLabel(l.ot_minutes)}
                    </td>
                    <td className="px-3 py-2 text-right tabular">{money(l.base_pay)}</td>
                    <td className="px-3 py-2 text-right tabular">{money(l.ot_pay)}</td>
                    <td className="px-3 py-2 text-right tabular text-bad" title={`Late ${money(l.late_deduction)} · Early ${money(l.early_deduction)} · Sandwich ${money(l.sandwich_deduction)} (${l.sandwich_days} day)`}>
                      {cuts ? `−${money(cuts)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-xs">
                      {Number(l.bonus) > 0 && <span className="text-good">+{money(l.bonus)}</span>}
                      {Number(l.other_deduction) > 0 && <span className="block text-bad">−{money(l.other_deduction)}</span>}
                      {l.adjustment_note && <span className="block text-[10px] text-ink-faint">{l.adjustment_note}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular">{money(l.gross)}</td>
                    <td className="px-3 py-2 text-right tabular">{Number(l.advance_recovery) ? `−${money(l.advance_recovery)}` : "—"}</td>
                    <td className={`px-3 py-2 text-right tabular font-medium ${Number(l.net) < 0 ? "text-bad" : ""}`}>{money(l.net)}</td>
                    <td className="px-3 py-2 text-right space-y-1">
                      {editable && (
                        <SalaryLineAdjust
                          sheetId={sheet.id}
                          lineId={l.id}
                          bonus={Number(l.bonus)}
                          otherDeduction={Number(l.other_deduction)}
                          advanceRecovery={Number(l.advance_recovery)}
                          note={l.adjustment_note}
                          advanceOwed={owed.get(l.employee_id) ?? 0}
                        />
                      )}
                      <a href={`/hr/salary/${sheet.id}/payslip/${l.id}`} target="_blank" className="block text-xs text-accent-ink underline underline-offset-2">
                        Payslip
                      </a>
                    </td>
                  </tr>
                );
              })}
              {!sorted.length && (
                <tr>
                  <td colSpan={11} className="px-4 py-6 text-center text-ink-faint">
                    No employee belongs on this sheet for this period.
                  </td>
                </tr>
              )}
            </tbody>
            {sorted.length > 0 && (
              <tfoot className="border-t-2 border-line-strong bg-surface-2 text-sm font-medium">
                <tr>
                  <td className="px-3 py-2" colSpan={3}>
                    Total ({sorted.length})
                  </td>
                  <td className="px-3 py-2 text-right tabular">{money(sum("base_pay"))}</td>
                  <td className="px-3 py-2 text-right tabular">{money(sum("ot_pay"))}</td>
                  <td className="px-3 py-2 text-right tabular text-bad">−{money(sum("late_deduction") + sum("early_deduction") + sum("sandwich_deduction"))}</td>
                  <td className="px-3 py-2 text-right tabular text-xs">
                    +{money(sum("bonus"))} / −{money(sum("other_deduction"))}
                  </td>
                  <td className="px-3 py-2 text-right tabular">{money(sheet.gross_total)}</td>
                  <td className="px-3 py-2 text-right tabular">−{money(sheet.advance_total)}</td>
                  <td className="px-3 py-2 text-right tabular">{money(sheet.net_total)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {sheet.status === "Draft" && (
        <p className="text-xs text-ink-faint">
          Draft figures were worked out when the sheet was created or last recalculated. Attendance entered since then shows after
          &quot;Recalculate&quot; (finalising always recalculates first).
        </p>
      )}
    </div>
  );
}
