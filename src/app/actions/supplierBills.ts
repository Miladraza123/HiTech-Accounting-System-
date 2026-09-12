"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export type ActionResult = { error: string | null; id?: string };

const NO_PERMISSION: ActionResult = { error: "Aap ke paas yeh action karne ki ijazat nahi hai." };

export async function createSupplierBillAction(input: {
  grn_id: string;
  bill_date: string;
  supplier_bill_ref: string | null;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "supplier_bill.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_supplier_bill", {
    p_grn_id: input.grn_id,
    p_bill_date: input.bill_date,
    p_supplier_bill_ref: input.supplier_bill_ref as string,
  });
  if (error) return { error: error.message };
  revalidatePath("/supplier-bills");
  return { error: null, id: data as string };
}

export async function cancelSupplierBillAction(billId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "supplier_bill.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_supplier_bill", { p_supplier_bill_id: billId, p_reason: reason });
  revalidatePath(`/supplier-bills/${billId}`);
  revalidatePath("/supplier-bills");
  return { error: error?.message ?? null };
}
