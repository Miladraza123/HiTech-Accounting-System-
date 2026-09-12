import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { PeriodLockForm } from "@/components/PeriodLockForm";

export default async function PeriodLockPage() {
  const user = await getCurrentUser();
  if (!isOwner(user)) redirect("/");

  const supabase = await createClient();
  const { data: company } = await supabase.from("company").select("period_lock_date").maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Period Lock</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Lock a date to close the books — no new entry before that date can be posted.
        </p>
      </div>

      {company?.period_lock_date ? (
        <div className="rounded-md bg-warn-soft border border-warn px-4 py-2 text-sm text-warn">
          Currently locked: no new entry can be posted on or before <span className="font-semibold">{company.period_lock_date}</span>.
        </div>
      ) : (
        <div className="rounded-md bg-good-soft border border-good px-4 py-2 text-sm text-good">There is no Period Lock yet — all dates are open.</div>
      )}

      <PeriodLockForm currentLockDate={company?.period_lock_date ?? null} />
    </div>
  );
}
