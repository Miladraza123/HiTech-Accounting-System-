import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canManageHr, canReadHr, loadPolicyGroupOptions } from "@/lib/hrAccess";
import { EMPLOYEE_TYPE_LABELS, RULE_LABELS, asOverrides, asRules, formatPay, formatRuleValue, summarizeRules, type RuleKey } from "@/lib/hrRules";
import { karachiToday } from "@/lib/karachiTime";
import { deleteEmployeeTermsAction } from "@/app/actions/hr";
import { EmployeeForm } from "@/components/EmployeeForm";
import { EmployeeTermsForm } from "@/components/EmployeeTermsForm";
import { EmployeeStatusPanel } from "@/components/EmployeeStatusPanel";
import { ConfirmActionButton } from "@/components/ConfirmActionButton";
import type { TermsDraft } from "@/components/EmployeeTermsFields";

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!canReadHr(user)) redirect("/");
  const canManage = canManageHr(user);
  const { id } = await params;

  const supabase = await createClient();
  const [{ data: emp }, { data: terms }, groups] = await Promise.all([
    supabase.from("hr_employees").select("*").eq("id", id).maybeSingle(),
    supabase.from("hr_employee_terms").select("*, hr_policy_groups(name), profiles(full_name)").eq("employee_id", id).order("effective_from", { ascending: false }),
    loadPolicyGroupOptions(supabase),
  ]);
  if (!emp) notFound();

  const today = karachiToday();
  const asOf = today < emp.join_date ? emp.join_date : emp.leave_date && today > emp.leave_date ? emp.leave_date : today;
  const [{ data: rulesNow }, { data: leaveBal }, { data: advBal }] = await Promise.all([
    supabase.rpc("fn_hr_rules_for", { p_employee_id: id, p_date: asOf }),
    supabase.rpc("fn_hr_leave_balance", { p_year: Number(asOf.slice(0, 4)), p_employee_ids: [id] }),
    supabase.from("hr_advance_balances").select("outstanding").eq("employee_id", id),
  ]);
  const leave = leaveBal?.[0];
  const advanceOwed = (advBal ?? []).reduce((t, b) => t + Number(b.outstanding ?? 0), 0);
  const current = (terms ?? []).find((t) => t.effective_from <= asOf) ?? null;
  const latest = (terms ?? [])[0] ?? null;
  const overridesNow = asOverrides(current?.rule_overrides);

  const latestDraft: TermsDraft | null = latest && {
    policy_group_id: latest.policy_group_id,
    employee_type: latest.employee_type as TermsDraft["employee_type"],
    monthly_salary: latest.monthly_salary === null ? "" : String(latest.monthly_salary),
    wage_basis: (latest.wage_basis as TermsDraft["wage_basis"]) ?? "per_day",
    wage_rate: latest.wage_rate === null ? "" : String(latest.wage_rate),
    rule_overrides: asOverrides(latest.rule_overrides),
  };
  // The group a terms row points at may since have been switched off; keep it selectable for this employee.
  const groupOptions =
    latest && !groups.some((g) => g.id === latest.policy_group_id)
      ? [...groups, { id: latest.policy_group_id, name: `${(latest.hr_policy_groups as unknown as { name: string } | null)?.name ?? "Group"} (off)`, rules: asRules(rulesNow) }]
      : groups;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/hr/employees" className="text-xs text-accent-ink underline underline-offset-2">
            ← Employees
          </Link>
          <h1 className="mt-2 text-lg font-semibold text-ink">
            {emp.full_name} <span className="font-mono text-sm text-ink-faint">{emp.code}</span>
          </h1>
          <p className="text-sm text-ink-soft">
            Joined {emp.join_date}
            {emp.leave_date && ` · Left ${emp.leave_date}`}
            {emp.designation && ` · ${emp.designation}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/hr/attendance/employee/${emp.id}`} className="text-xs text-accent-ink underline underline-offset-2">
            Attendance by month
          </Link>
          <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${emp.status === "Active" ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"}`}>
            {emp.status}
          </span>
          {canManage && <EmployeeStatusPanel employeeId={emp.id} status={emp.status} joinDate={emp.join_date} />}
        </div>
      </div>

      <section className="rounded-xl border border-line bg-surface p-4 sm:p-5 space-y-3">
        <h2 className="text-sm font-semibold text-ink">
          Terms on {asOf}
          {asOf !== today && <span className="ml-1 text-xs font-normal text-ink-faint">(today is outside the employment dates)</span>}
        </h2>
        {current ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink-faint">Type</p>
              <p className="text-ink">{EMPLOYEE_TYPE_LABELS[current.employee_type]}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint">Pay</p>
              <p className="text-ink tabular">{formatPay(current)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint">Policy group</p>
              <Link href={`/hr/policies/${current.policy_group_id}`} className="text-accent-ink underline underline-offset-2">
                {(current.hr_policy_groups as unknown as { name: string } | null)?.name}
              </Link>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-faint">No terms.</p>
        )}
        <p className="text-sm text-ink-soft">
          {current?.employee_type === "permanent" && leave && (
            <>
              Paid leave {asOf.slice(0, 4)}: {Number(leave.used)} of {Number(leave.quota)} used, {Number(leave.remaining)} left
              {Number(leave.unpaid_extra) > 0 && ` (${Number(leave.unpaid_extra)} extra day(s) unpaid)`} ·{" "}
            </>
          )}
          Advance owed: Rs {advanceOwed.toLocaleString()}
        </p>
        {rulesNow && (
          <div>
            <p className="text-xs text-ink-faint mb-1">Rules that apply (group + this employee&apos;s own rules)</p>
            <ul className="text-sm text-ink-soft list-disc list-inside space-y-0.5">
              {summarizeRules(asRules(rulesNow)).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {Object.keys(overridesNow).length > 0 && (
              <p className="mt-2 text-xs text-ink-soft">
                Own rules:{" "}
                {(Object.keys(overridesNow) as RuleKey[]).map((k) => `${RULE_LABELS[k]} = ${formatRuleValue(k, overridesNow)}`).join(" · ")}
              </p>
            )}
          </div>
        )}
      </section>

      {canManage && latestDraft && emp.status === "Active" && (
        <EmployeeTermsForm employeeId={emp.id} groups={groupOptions} latest={latestDraft} joinDate={emp.join_date} leaveDate={emp.leave_date} />
      )}

      <section className="rounded-xl border border-line bg-surface overflow-hidden">
        <h2 className="px-4 pt-4 text-sm font-semibold text-ink">Terms History</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm mt-2">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">From</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-right px-4 py-2.5">Pay</th>
                <th className="text-left px-4 py-2.5">Group</th>
                <th className="text-left px-4 py-2.5">Own rules</th>
                <th className="text-left px-4 py-2.5">Reason · By</th>
                {canManage && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {(terms ?? []).map((t) => {
                const o = asOverrides(t.rule_overrides);
                const keys = Object.keys(o) as RuleKey[];
                return (
                  <tr key={t.id} className={`border-t border-line ${t.id === current?.id ? "bg-accent-soft/40" : ""}`}>
                    <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                      {t.effective_from}
                      {t.effective_from > today && <span className="ml-1 text-[10px] text-warn">upcoming</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs">{EMPLOYEE_TYPE_LABELS[t.employee_type]}</td>
                    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap">{formatPay(t)}</td>
                    <td className="px-4 py-2.5 text-xs">{(t.hr_policy_groups as unknown as { name: string } | null)?.name}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-soft">
                      {keys.length ? keys.map((k) => `${RULE_LABELS[k]}: ${formatRuleValue(k, o)}`).join(" · ") : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-soft">
                      {t.reason ?? "—"}
                      <span className="block text-[10px] text-ink-faint">{(t.profiles as unknown as { full_name: string } | null)?.full_name}</span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-2.5 text-right">
                        {t.effective_from > emp.join_date && (
                          <ConfirmActionButton
                            label="Remove"
                            confirmText="Remove this change?"
                            action={deleteEmployeeTermsAction.bind(null, emp.id, t.id)}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">Personal Details</h2>
        {canManage ? (
          <EmployeeForm
            mode="edit"
            employeeId={emp.id}
            initial={{
              code: emp.code,
              full_name: emp.full_name,
              father_name: emp.father_name ?? "",
              cnic: emp.cnic ?? "",
              phone: emp.phone ?? "",
              address: emp.address ?? "",
              designation: emp.designation ?? "",
              department: emp.department ?? "",
              join_date: emp.join_date,
              notes: emp.notes ?? "",
            }}
          />
        ) : (
          <dl className="rounded-xl border border-line bg-surface p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {(
              [
                ["Father's name", emp.father_name],
                ["CNIC", emp.cnic],
                ["Phone", emp.phone],
                ["Department", emp.department],
                ["Address", emp.address],
                ["Notes", emp.notes],
              ] as const
            ).map(([l, v]) => (
              <div key={l}>
                <dt className="text-xs text-ink-faint">{l}</dt>
                <dd className="text-ink">{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
