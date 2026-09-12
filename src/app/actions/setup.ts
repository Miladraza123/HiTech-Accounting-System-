"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { diffFields, smartMergeUpdate, type SmartMergeConflict } from "@/lib/smartMerge";

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";

export type ActionResult = { error: string | null; success?: boolean; conflicts?: SmartMergeConflict[] };

// ---------- Company ----------
// Smart Merge: the form also submits a `base_*` hidden field per editable
// column, holding the value this browser tab had loaded when it opened
// the form. On save, only the fields that actually changed are sent, and
// only a field someone else *also* changed (to a different value) since
// this tab loaded the page comes back as a conflict — every other field
// this admin edited is still saved immediately.
export async function saveCompanyAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();

  const legal_name = String(formData.get("legal_name") ?? "").trim();
  if (!legal_name) return { error: "Company name is required." };

  const field = (name: string) => String(formData.get(name) ?? "").trim() || null;
  const next = {
    legal_name,
    ntn: field("ntn"),
    strn: field("strn"),
    address: field("address"),
    province: field("province"),
    phone: field("phone"),
    email: field("email"),
    default_sales_tax_pct: Number(formData.get("default_sales_tax_pct") ?? 18),
  };

  const { data: existing } = await supabase.from("company").select("id").maybeSingle();

  if (!existing) {
    // First-time setup — nothing to merge against yet.
    const { error } = await supabase.from("company").insert({ id: COMPANY_ID, ...next });
    if (error) return { error: error.message };
    revalidatePath("/setup/company");
    revalidatePath("/");
    return { error: null, success: true };
  }

  const base = {
    legal_name: field("base_legal_name"),
    ntn: field("base_ntn"),
    strn: field("base_strn"),
    address: field("base_address"),
    province: field("base_province"),
    phone: field("base_phone"),
    email: field("base_email"),
    default_sales_tax_pct: Number(formData.get("base_default_sales_tax_pct") ?? 18),
  };
  const changes = diffFields(base, next);
  const { result, error } = await smartMergeUpdate(supabase, "company", COMPANY_ID, base, changes);
  if (error) return { error };

  // Any non-conflicting field was applied even when others conflicted —
  // revalidate either way so the page's own data reflects it.
  revalidatePath("/setup/company");
  revalidatePath("/");

  if (result && result.conflicts.length > 0) {
    return { error: null, conflicts: result.conflicts };
  }
  return { error: null, success: true };
}

// ---------- Warehouses ----------
export async function addWarehouseAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();

  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;

  if (!code || !name) return { error: "Code and name are required." };

  const { error } = await supabase.from("warehouses").insert({ code, name, address });
  if (error) return { error: error.message };

  revalidatePath("/setup/warehouses");
  return { error: null, success: true };
}

export async function toggleWarehouseAction(id: string, isActive: boolean) {
  const supabase = await createClient();
  await supabase.from("warehouses").update({ is_active: isActive }).eq("id", id);
  revalidatePath("/setup/warehouses");
}

// ---------- Chart of Accounts ----------
export async function addAccountAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();

  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const account_type = String(formData.get("account_type") ?? "");
  const parent_id = String(formData.get("parent_id") ?? "") || null;

  if (!code || !name || !account_type) return { error: "Code, name and type are required." };

  const { error } = await supabase
    .from("chart_of_accounts")
    .insert({ code, name, account_type, parent_id });
  if (error) return { error: error.message };

  revalidatePath("/setup/chart-of-accounts");
  return { error: null, success: true };
}

// ---------- Period Lock ----------
export async function setPeriodLockAction(lockDate: string | null): Promise<ActionResult> {
  const supabase = await createClient();
  // `fn_set_period_lock`'s `p_lock_date date` param has no SQL default, so
  // the generated RPC type is non-nullable `string` — but Postgres and
  // this function both happily accept a literal NULL (that's exactly how
  // the lock gets cleared), so this cast is purely for the type checker.
  const { error } = await supabase.rpc("fn_set_period_lock", { p_lock_date: lockDate as string });
  if (error) return { error: error.message };
  revalidatePath("/setup/period-lock");
  return { error: null, success: true };
}

// ---------- Users & Roles ----------
export async function assignRoleAction(userId: string, roleId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("user_roles")
    .insert({ user_id: userId, role_id: roleId, assigned_by: user?.id });

  revalidatePath("/setup/users");
  if (error) return { error: error.message };
  return { error: null };
}

export async function revokeRoleAction(userId: string, roleId: string) {
  const supabase = await createClient();
  await supabase.from("user_roles").delete().eq("user_id", userId).eq("role_id", roleId);
  revalidatePath("/setup/users");
}

// ---------- New User (invite) ----------
// There's no Supabase Service Role key configured in this app (only the
// publishable anon key), so there's no way to call the Admin API and
// instantly create someone else's login from the server — and one
// should never be hardcoded here to work around that. Instead the Owner
// invites a teammate by email + name + role(s); fn_invite_user stores
// it, and fn_handle_new_user (a DB trigger) applies the pre-selected
// role(s) automatically the moment that person signs up with the same
// email — see supabase/migrations/20260912190000_phase20_01_user_invites.sql.
export async function inviteUserAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const roleIds = formData.getAll("role_ids").map(String).filter(Boolean);

  if (!email || !fullName) return { error: "Full name and email are required." };
  if (roleIds.length === 0) return { error: "Select at least one role for this user." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_invite_user", {
    p_email: email,
    p_full_name: fullName,
    p_role_ids: roleIds,
  });
  if (error) return { error: error.message };

  revalidatePath("/setup/users");
  return { error: null, success: true };
}

export async function revokeInviteAction(inviteId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_revoke_invite", { p_invite_id: inviteId });
  revalidatePath("/setup/users");
  if (error) return { error: error.message };
  return { error: null };
}
