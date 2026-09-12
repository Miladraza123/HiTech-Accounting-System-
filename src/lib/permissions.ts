import { createClient } from "@/lib/supabase/server";
import { isOwner, type CurrentUser } from "@/lib/auth";
import { PERMISSION_DEFS, type PermissionKey } from "@/lib/permissionDefs";

export { PERMISSION_DEFS, PERMISSION_MODULES, type PermissionKey, type PermissionDef } from "@/lib/permissionDefs";

// Configurable Permission Matrix — app-layer only (see README for the
// scope decision). Every key maps to a SQL function that carries its OWN
// hardcoded role check as an unchangeable floor, so a role can only ever
// be granted here up to what the database already allows for that
// action — granting more is a no-op that fails loudly with the
// database's own rejection message the first time it's tried.

async function fetchAllowedRoles(key: PermissionKey): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("role_permissions").select("role_codes").eq("permission_key", key).maybeSingle();
  if (data) return data.role_codes;
  return PERMISSION_DEFS.find((p) => p.key === key)?.dbAllowedRoles ?? [];
}

/** Owner always passes. Otherwise checks the user's roles against the configurable matrix (falling back to the original hardcoded default if the matrix row is somehow missing). */
export async function hasPermission(user: CurrentUser | null, key: PermissionKey): Promise<boolean> {
  if (isOwner(user)) return true;
  if (!user) return false;
  const allowed = await fetchAllowedRoles(key);
  return user.roles.some((r) => allowed.includes(r));
}

/** Loads the full matrix at once for the /setup/permissions admin page. */
export async function loadPermissionMatrix(): Promise<Record<PermissionKey, string[]>> {
  const supabase = await createClient();
  const { data } = await supabase.from("role_permissions").select("*");
  const byKey = new Map((data ?? []).map((r) => [r.permission_key, r.role_codes]));
  const result = {} as Record<PermissionKey, string[]>;
  for (const def of PERMISSION_DEFS) {
    result[def.key] = byKey.get(def.key) ?? def.dbAllowedRoles;
  }
  return result;
}
