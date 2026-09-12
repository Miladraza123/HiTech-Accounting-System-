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
          Books close karne ke liye ek date lock karen — us se pehle ki koi bhi nayi entry post nahi ho sakegi.
        </p>
      </div>

      {company?.period_lock_date ? (
        <div className="rounded-md bg-warn-soft border border-warn px-4 py-2 text-sm text-warn">
          Currently locked: <span className="font-semibold">{company.period_lock_date}</span> tak ki tareekh par koi nayi entry post nahi ho sakti.
        </div>
      ) : (
        <div className="rounded-md bg-good-soft border border-good px-4 py-2 text-sm text-good">Abhi koi Period Lock nahi hai — sab dates open hain.</div>
      )}

      <PeriodLockForm currentLockDate={company?.period_lock_date ?? null} />
    </div>
  );
}
