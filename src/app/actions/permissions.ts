"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { PermissionKey } from "@/lib/permissions";

export type ActionResult = { error: string | null };

export async function setRolePermissionAction(key: PermissionKey, roleCodes: string[]): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_set_role_permission", { p_permission_key: key, p_role_codes: roleCodes });
  if (error) return { error: error.message };
  revalidatePath("/setup/permissions");
  return { error: null };
}
