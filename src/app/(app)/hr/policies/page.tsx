import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canManageHr, canReadHr } from "@/lib/hrAccess";
import { asRules, summarizeRules } from "@/lib/hrRules";
import { karachiToday } from "@/lib/karachiTime";
import { NewPolicyGroupForm } from "@/components/NewPolicyGroupForm";

export default async function PoliciesPage() {
  const user = await getCurrentUser();
  if (!canReadHr(user)) redirect("/");
  const canManage = canManageHr(user);

  const supabase = await createClient();
  const [{ data: groups }, { data: versions }, { data: employees }] = await Promise.all([
    supabase.from("hr_policy_groups").select("*").order("is_active", { ascending: false }).order("name"),
    supabase.from("hr_policy_versions").select("group_id, effective_from, rules").order("effective_from", { ascending: false }),
    supabase.from("hr_employees_current").select("policy_group_id").eq("status", "Active"),
  ]);

  const today = karachiToday();
  const counts = new Map<string, number>();
  for (const e of employees ?? []) if (e.policy_group_id) counts.set(e.policy_group_id, (counts.get(e.policy_group_id) ?? 0) + 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Attendance Policies</h1>
        <p className="mt-1 text-sm text-ink-soft">
          A policy group holds the shift timing, late/early rules, overtime, sandwich rule, wager pay cycle and paid leaves for a set of employees.
          Any one employee can still have their own value for any rule. Every change asks for the date it starts from.
        </p>
      </div>

      {canManage && <NewPolicyGroupForm />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(groups ?? []).map((g) => {
          const gv = (versions ?? []).filter((v) => v.group_id === g.id);
          const now = gv.find((v) => v.effective_from <= today) ?? gv[gv.length - 1];
          const upcoming = gv.filter((v) => v.effective_from > today);
          return (
            <Link key={g.id} href={`/hr/policies/${g.id}`} className="block rounded-xl border border-line bg-surface p-4 hover:bg-surface-2 transition">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-ink">{g.name}</p>
                  {g.description && <p className="text-xs text-ink-soft">{g.description}</p>}
                </div>
                <div className="text-right text-xs space-y-1">
                  <span className={`rounded-full px-2 py-0.5 font-mono ${g.is_active ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"}`}>
                    {g.is_active ? "Active" : "Off"}
                  </span>
                  <p className="text-ink-faint">{counts.get(g.id) ?? 0} employees</p>
                </div>
              </div>
              {now && (
                <ul className="mt-3 text-xs text-ink-soft list-disc list-inside space-y-0.5">
                  {summarizeRules(asRules(now.rules)).slice(0, 4).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-ink-faint">
                {gv.length} version{gv.length === 1 ? "" : "s"}
                {now && now.effective_from <= today && ` · current since ${now.effective_from}`}
                {upcoming.length > 0 && <span className="text-warn"> · change from {upcoming[upcoming.length - 1].effective_from}</span>}
              </p>
            </Link>
          );
        })}
        {!groups?.length && <p className="text-sm text-ink-faint">No policy group yet. Create one, then add employees to it.</p>}
      </div>
    </div>
  );
}
