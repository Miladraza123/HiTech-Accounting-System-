import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canManageHr, canReadHr } from "@/lib/hrAccess";
import { karachiToday } from "@/lib/karachiTime";
import { deleteHolidayAction } from "@/app/actions/hr";
import { HolidayForm } from "@/components/HolidayForm";
import { LeaveTypeRow } from "@/components/LeaveTypeRow";
import { ConfirmActionButton } from "@/components/ConfirmActionButton";

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await getCurrentUser();
  if (!canReadHr(user)) redirect("/");
  const canManage = canManageHr(user);
  const { year: rawYear } = await searchParams;
  const year = /^\d{4}$/.test(rawYear ?? "") ? Number(rawYear) : Number(karachiToday().slice(0, 4));

  const supabase = await createClient();
  const [{ data: holidays }, { data: leaveTypes }, { data: used }] = await Promise.all([
    supabase.from("hr_holidays").select("*").gte("holiday_date", `${year}-01-01`).lte("holiday_date", `${year}-12-31`).order("holiday_date"),
    supabase.from("hr_leave_types").select("*").order("name"),
    supabase.rpc("fn_hr_used_leave_types"),
  ]);
  const usedSet = new Set((used as string[] | null) ?? []);

  return (
    <div className="space-y-8 max-w-4xl">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-ink">Holidays {year}</h1>
            <p className="mt-1 text-sm text-ink-soft">
              A holiday is a day off for everyone. Permanent staff are paid for it (it is not counted in the month&apos;s working days); work done on it
              counts as off-day work.
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <a href={`/hr/holidays?year=${year - 1}`} className="rounded-md border border-line px-2 py-1">
              ← {year - 1}
            </a>
            <a href={`/hr/holidays?year=${year + 1}`} className="rounded-md border border-line px-2 py-1">
              {year + 1} →
            </a>
          </div>
        </div>
        {canManage && <HolidayForm />}
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Holiday</th>
                {canManage && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {(holidays ?? []).map((h) => (
                <tr key={h.id} className="border-t border-line">
                  <td className="px-4 py-2.5 font-mono text-xs">{h.holiday_date}</td>
                  <td className="px-4 py-2.5">{h.name}</td>
                  {canManage && (
                    <td className="px-4 py-2.5 text-right">
                      <ConfirmActionButton label="Remove" confirmText="Remove this holiday?" action={deleteHolidayAction.bind(null, h.id)} />
                    </td>
                  )}
                </tr>
              ))}
              {!holidays?.length && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-ink-faint">
                    No holidays in {year}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Leave Types</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Paid leave comes out of the employee&apos;s yearly paid-leave quota (set in the policy group, or per employee). Leave beyond the quota is
            unpaid. Daily wagers are never paid for leave.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Pay</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {canManage ? (
                <>
                  {(leaveTypes ?? []).map((t) => (
                    <LeaveTypeRow key={t.id} type={{ ...t, used: usedSet.has(t.id) }} />
                  ))}
                  <LeaveTypeRow />
                </>
              ) : (
                (leaveTypes ?? []).map((t) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className="px-4 py-2.5">{t.name}</td>
                    <td className="px-4 py-2.5">{t.is_paid ? "Paid" : "Unpaid"}</td>
                    <td className="px-4 py-2.5">{t.is_active ? "Active" : "Off"}</td>
                    <td />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
