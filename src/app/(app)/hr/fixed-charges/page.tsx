import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, isOwner } from "@/lib/auth";
import { canReadHr } from "@/lib/hrAccess";
import { money } from "@/lib/hrSalary";
import { FixedChargesEditor } from "@/components/FixedChargesEditor";
import { ApplyFixedChargeForm } from "@/components/ApplyFixedChargeForm";

export default async function FixedChargesPage() {
  const user = await getCurrentUser();
  if (!canReadHr(user)) redirect("/");
  const canEdit = isOwner(user) || hasRole(user, "hr") || hasRole(user, "accounts");

  const supabase = await createClient();
  const [{ data: employees }, { data: charges }] = await Promise.all([
    supabase.from("hr_employees").select("id, code, full_name, status").eq("status", "Active").order("full_name"),
    supabase.from("hr_fixed_charges").select("id, employee_id, name, amount, is_active").order("created_at"),
  ]);
  const byEmp = new Map<string, NonNullable<typeof charges>>();
  for (const c of charges ?? []) byEmp.set(c.employee_id, [...(byEmp.get(c.employee_id) ?? []), c]);

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold text-ink">Fixed Charges</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Amounts cut from an employee&apos;s salary every month (lunch, uniform, ...). Set them once here or on the employee&apos;s page. Each new salary
          sheet copies the active charges, and the amounts can still be changed on the sheet for that month. A sheet already made keeps its own figures.
        </p>
      </div>

      {canEdit && <ApplyFixedChargeForm employees={(employees ?? []).map((e) => ({ id: e.id, code: e.code, full_name: e.full_name }))} />}

      <div className="space-y-2">
        {(employees ?? []).map((e) => {
          const list = byEmp.get(e.id) ?? [];
          const active = list.filter((c) => c.is_active);
          const total = active.reduce((t, c) => t + Number(c.amount), 0);
          return (
            <details key={e.id} className="rounded-xl border border-line bg-surface">
              <summary className="cursor-pointer list-none px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-ink">
                  {e.full_name} <span className="font-mono text-xs text-ink-faint">{e.code}</span>
                </span>
                <span className="text-xs text-ink-soft">
                  {active.length ? `${active.map((c) => `${c.name} ${money(c.amount)}`).join(" · ")} — total ${money(total)}` : "No fixed charges"}
                </span>
              </summary>
              <div className="border-t border-line px-4 py-3 space-y-2">
                <FixedChargesEditor
                  key={list.map((c) => `${c.id}:${c.name}:${c.amount}:${c.is_active}`).join("|")}
                  employeeId={e.id}
                  canEdit={canEdit}
                  initial={list.map((c) => ({ id: c.id, name: c.name, amount: Number(c.amount), is_active: c.is_active }))}
                />
                <Link href={`/hr/employees/${e.id}`} className="text-xs text-accent-ink underline underline-offset-2">
                  Open employee
                </Link>
              </div>
            </details>
          );
        })}
        {!(employees ?? []).length && <p className="text-sm text-ink-faint">No active employees.</p>}
      </div>
    </div>
  );
}
