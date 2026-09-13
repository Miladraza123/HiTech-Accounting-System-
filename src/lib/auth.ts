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

  // Defense-in-depth for Two-Factor Authentication: signInAction() already
  // sends a password-only session straight to /mfa-challenge instead of
  // "/", but if a session somehow reaches a protected page without ever
  // completing that (e.g. a very old tab left open mid-login), treat it
  // as not fully signed in here too rather than trusting only that one
  // redirect. This reads the aal claim already on the JWT — no network
  // call — so it costs nothing on a normal, already-verified session.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
    return null;
  }

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
