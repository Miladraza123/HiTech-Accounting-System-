"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";

export type ActionResult = { error: string | null; success?: boolean };

// ---------- Company ----------
export async function saveCompanyAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();

  const legal_name = String(formData.get("legal_name") ?? "").trim();
  if (!legal_name) return { error: "Company ka naam zaroori hai." };

  const payload = {
    id: COMPANY_ID,
    legal_name,
    ntn: String(formData.get("ntn") ?? "").trim() || null,
    strn: String(formData.get("strn") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    province: String(formData.get("province") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    default_sales_tax_pct: Number(formData.get("default_sales_tax_pct") ?? 18),
  };

  const { error } = await supabase.from("company").upsert(payload);
  if (error) return { error: error.message };

  revalidatePath("/setup/company");
  revalidatePath("/");
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

  if (!code || !name) return { error: "Code aur naam zaroori hain." };

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

  if (!code || !name || !account_type) return { error: "Code, naam aur type zaroori hain." };

  const { error } = await supabase
    .from("chart_of_accounts")
    .insert({ code, name, account_type, parent_id });
  if (error) return { error: error.message };

  revalidatePath("/setup/chart-of-accounts");
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
