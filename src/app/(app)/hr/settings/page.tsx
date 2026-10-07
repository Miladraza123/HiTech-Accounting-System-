import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { HrSettingsForm } from "@/components/HrSettingsForm";

export default async function HrSettingsPage() {
  const user = await getCurrentUser();
  if (!isOwner(user)) redirect("/");
  const supabase = await createClient();
  const { data: settings } = await supabase.from("hr_settings").select("*").maybeSingle();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-lg font-semibold text-ink">HR Settings</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Company-wide switches for attendance and salary. Shift timing, late rules, overtime, leaves and the wager pay cycle are set per policy
          group (HR / Attendance → Attendance Policies).
        </p>
      </div>
      <HrSettingsForm salaryJournalEnabled={settings?.salary_journal_enabled ?? false} />
      <p className="text-xs text-ink-faint">
        Who can use HR: give a user the &quot;HR / Attendance&quot; role in Setup → Users &amp; Roles. That user can add employees, change policies
        and (in the next part) enter daily attendance. Accounts and Auditor can view.
      </p>
    </div>
  );
}
