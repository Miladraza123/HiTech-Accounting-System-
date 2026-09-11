import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, ROLE_LABELS } from "@/lib/auth";
import { RoleAssignRow, RevokeRoleChip } from "@/components/RoleAssignRow";

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!isOwner(user)) redirect("/");

  const supabase = await createClient();
  const [{ data: profiles }, { data: roles }, { data: userRoles }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at"),
    supabase.from("roles").select("*").order("name"),
    supabase.from("user_roles").select("user_id, role_id, roles(id, code)"),
  ]);

  const rolesByUser = new Map<string, { id: string; code: string }[]>();
  for (const ur of userRoles ?? []) {
    const list = rolesByUser.get(ur.user_id) ?? [];
    const role = ur.roles as unknown as { id: string; code: string } | null;
    if (role) list.push(role);
    rolesByUser.set(ur.user_id, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Users &amp; Roles</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Har team member ko sirf uske kaam ke mutabiq role dें — permissions server par (RLS)
          enforce hoti hain, sirf screen chhupane se nahi.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface divide-y divide-line">
        {(profiles ?? []).map((p) => {
          const assigned = rolesByUser.get(p.id) ?? [];
          return (
            <div key={p.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
              <div>
                <p className="text-sm text-ink font-medium">{p.full_name}</p>
                <p className="text-xs text-ink-faint">{p.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {assigned.length === 0 && <span className="text-xs text-ink-faint">Koi role nahi</span>}
                {assigned.map((r) => (
                  <RevokeRoleChip key={r.id} userId={p.id} roleId={r.id} label={ROLE_LABELS[r.code] ?? r.code} />
                ))}
                <RoleAssignRow
                  userId={p.id}
                  assignedRoleIds={assigned.map((r) => r.id)}
                  allRoles={(roles ?? []).map((r) => ({ id: r.id, code: r.code }))}
                />
              </div>
            </div>
          );
        })}
        {!profiles?.length && <div className="px-5 py-6 text-center text-sm text-ink-faint">Koi user nahi mila.</div>}
      </div>
    </div>
  );
}
