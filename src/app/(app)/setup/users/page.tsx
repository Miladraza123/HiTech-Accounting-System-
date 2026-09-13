import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, ROLE_LABELS } from "@/lib/auth";
import { RoleAssignRow, RevokeRoleChip } from "@/components/RoleAssignRow";
import { InviteUserForm, PendingInviteRow } from "@/components/InviteUserForm";
import { UserRowActions } from "@/components/UserRowActions";

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!isOwner(user)) redirect("/");

  const supabase = await createClient();
  const [{ data: profiles }, { data: roles }, { data: userRoles }, { data: invites }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, is_active, created_at").order("created_at"),
    supabase.from("roles").select("*").order("name"),
    supabase.from("user_roles").select("user_id, role_id, roles(id, code)"),
    supabase
      .from("user_invites")
      .select("id, email, full_name, role_ids")
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const rolesByUser = new Map<string, { id: string; code: string }[]>();
  for (const ur of userRoles ?? []) {
    const list = rolesByUser.get(ur.user_id) ?? [];
    const role = ur.roles as unknown as { id: string; code: string } | null;
    if (role) list.push(role);
    rolesByUser.set(ur.user_id, list);
  }

  const allRoles = (roles ?? []).map((r) => ({ id: r.id, code: r.code }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Users &amp; Roles</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Assign each team member only the role that matches their job — permissions are
            enforced on the server (RLS), not just by hiding parts of the screen.
          </p>
        </div>
        <InviteUserForm allRoles={allRoles} />
      </div>

      {!!invites?.length && (
        <div className="rounded-xl border border-line bg-surface divide-y divide-line">
          <div className="px-5 py-3 border-b border-line">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Pending — account creation didn&apos;t complete
            </p>
          </div>
          {invites.map((inv) => (
            <PendingInviteRow key={inv.id} invite={inv} />
          ))}
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface divide-y divide-line">
        {(profiles ?? []).map((p) => {
          const assigned = rolesByUser.get(p.id) ?? [];
          return (
            <div key={p.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
              <div>
                <p className="text-sm text-ink font-medium">{p.full_name}</p>
                <p className="text-xs text-ink-faint">{p.email}</p>
              </div>
              <div className="flex flex-col items-start sm:items-end gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {assigned.length === 0 && <span className="text-xs text-ink-faint">No role</span>}
                  {assigned.map((r) => (
                    <RevokeRoleChip key={r.id} userId={p.id} roleId={r.id} label={ROLE_LABELS[r.code] ?? r.code} />
                  ))}
                  <RoleAssignRow userId={p.id} assignedRoleIds={assigned.map((r) => r.id)} allRoles={allRoles} />
                </div>
                <UserRowActions
                  userId={p.id}
                  fullName={p.full_name}
                  isActive={p.is_active !== false}
                  isSelf={p.id === user?.id}
                />
              </div>
            </div>
          );
        })}
        {!profiles?.length && <div className="px-5 py-6 text-center text-sm text-ink-faint">No user found.</div>}
      </div>
    </div>
  );
}
