import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRole, isOwner, type CurrentUser } from "@/lib/auth";
import { asRules, type HrRules } from "@/lib/hrRules";
import type { Database } from "@/lib/supabase/database.types";

// Mirrors fn_hr_can_read() / fn_hr_can_manage() in the database, which
// remain the real gate.
export function canReadHr(user: CurrentUser | null): boolean {
  return isOwner(user) || hasRole(user, "hr") || hasRole(user, "accounts") || hasRole(user, "auditor");
}

export function canManageHr(user: CurrentUser | null): boolean {
  return isOwner(user) || hasRole(user, "hr");
}

/** Active policy groups with their latest rules, for the employee forms. */
export async function loadPolicyGroupOptions(
  supabase: SupabaseClient<Database>
): Promise<{ id: string; name: string; rules: HrRules }[]> {
  const [{ data: groups }, { data: versions }] = await Promise.all([
    supabase.from("hr_policy_groups").select("id, name").eq("is_active", true).order("name"),
    supabase.from("hr_policy_versions").select("group_id, effective_from, rules").order("effective_from", { ascending: false }),
  ]);
  const latest = new Map<string, HrRules>();
  for (const v of versions ?? []) if (!latest.has(v.group_id)) latest.set(v.group_id, asRules(v.rules));
  return (groups ?? []).filter((g) => latest.has(g.id)).map((g) => ({ id: g.id, name: g.name, rules: latest.get(g.id)! }));
}
