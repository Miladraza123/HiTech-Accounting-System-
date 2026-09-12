"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export type ActionResult = { error: string | null; id?: string };

const NO_PERMISSION: ActionResult = { error: "Aap ke paas yeh action karne ki ijazat nahi hai." };

export type ReturnLineInput = { qty: number };

// ---- Sales Returns ----

export async function createSalesReturnAction(input: {
  invoice_id: string;
  warehouse_id: string;
  return_date: string;
  reason: string;
  lines: { invoice_line_id: string; qty: number }[];
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "sales_return.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_sales_return", {
    p_invoice_id: input.invoice_id,
    p_warehouse_id: input.warehouse_id,
    p_return_date: input.return_date,
    p_reason: input.reason,
    p_lines: input.lines,
  });
  if (error) return { error: error.message };
  revalidatePath(`/invoices/${input.invoice_id}`);
  revalidatePath("/sales-returns");
  return { error: null, id: data as string };
}

export async function cancelSalesReturnAction(returnId: string, invoiceId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "sales_return.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_sales_return", { p_return_id: returnId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/sales-returns/${returnId}`);
  revalidatePath("/sales-returns");
  return { error: null };
}

// ---- Purchase Returns ----

export async function createPurchaseReturnAction(input: {
  supplier_bill_id: string;
  warehouse_id: string;
  return_date: string;
  reason: string;
  lines: { supplier_bill_line_id: string; qty: number }[];
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "purchase_return.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_purchase_return", {
    p_supplier_bill_id: input.supplier_bill_id,
    p_warehouse_id: input.warehouse_id,
    p_return_date: input.return_date,
    p_reason: input.reason,
    p_lines: input.lines,
  });
  if (error) return { error: error.message };
  revalidatePath(`/supplier-bills/${input.supplier_bill_id}`);
  revalidatePath("/purchase-returns");
  return { error: null, id: data as string };
}

export async function cancelPurchaseReturnAction(returnId: string, supplierBillId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "purchase_return.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_purchase_return", { p_return_id: returnId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath(`/supplier-bills/${supplierBillId}`);
  revalidatePath(`/purchase-returns/${returnId}`);
  revalidatePath("/purchase-returns");
  return { error: null };
}
