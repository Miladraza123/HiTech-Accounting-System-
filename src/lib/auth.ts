import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/roles";

export { ROLE_LABELS };

export type CurrentUser = {
  id: string;
  email: string | null;
  fullName: string;
  roles: string[]; // role codes, e.g. ["owner", "accounts"]
};

/**
 * Loads the signed-in user plus their assigned role codes.
 * Returns null when nobody is signed in.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    supabase.from("profiles").select("full_name, email, is_active").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("roles(code)").eq("user_id", user.id),
  ]);

  // Deactivated by the Owner (Setup > Users & Roles). The Admin API ban
  // already blocks a fresh sign-in, but an already-issued session token
  // can otherwise keep working until it naturally expires — this cuts
  // it off on the very next request instead.
  if (profile && profile.is_active === false) {
    await supabase.auth.signOut();
    return null;
  }

  const roles = (roleRows ?? [])
    .map((r) => (r.roles as unknown as { code: string } | null)?.code)
    .filter((c): c is string => !!c);

  return {
    id: user.id,
    email: profile?.email ?? user.email ?? null,
    fullName: profile?.full_name ?? user.email ?? "User",
    roles,
  };
}

export function hasRole(user: CurrentUser | null, code: string): boolean {
  return !!user?.roles.includes(code);
}

export function isOwner(user: CurrentUser | null): boolean {
  return hasRole(user, "owner");
}
