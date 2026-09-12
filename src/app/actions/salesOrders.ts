"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

const NO_PERMISSION: ActionResult = { error: "You don't have permission to perform this action." };

export type SalesOrderLineInput = {
  id?: string;
  item_id?: string;
  description: string;
  ordered_qty: number;
  unit?: string;
  rate: number;
  tax_pct: number;
};

export type CreateSalesOrderInput = {
  quotation_id: string;
  client_po_number: string;
  po_date: string;
  delivery_schedule: string | null;
  payment_terms: string | null;
  business_line: string;
  lines: SalesOrderLineInput[];
  confirm_duplicate?: boolean;
};

export type ActionResult = { error: string | null; id?: string };

export async function createSalesOrderAction(input: CreateSalesOrderInput): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "sales_order.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_sales_order", {
    p_quotation_id: input.quotation_id,
    p_client_po_number: input.client_po_number,
    p_po_date: input.po_date,
    p_delivery_schedule: input.delivery_schedule as string,
    p_payment_terms: input.payment_terms as string,
    p_business_line: input.business_line,
    p_lines: input.lines,
    p_confirm_duplicate: input.confirm_duplicate ?? false,
  });

  if (error) return { error: error.message };
  revalidatePath("/sales-orders");
  return { error: null, id: data as string };
}

export async function amendSalesOrderAction(
  salesOrderId: string,
  reason: string,
  clientPoNumber: string,
  poDate: string,
  deliverySchedule: string | null,
  paymentTerms: string | null,
  lines: SalesOrderLineInput[]
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "sales_order.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_amend_sales_order", {
    p_sales_order_id: salesOrderId,
    p_reason: reason,
    p_client_po_number: clientPoNumber,
    p_po_date: poDate,
    p_delivery_schedule: deliverySchedule as string,
    p_payment_terms: paymentTerms as string,
    p_lines: lines,
  });
  revalidatePath(`/sales-orders/${salesOrderId}`);
  return { error: error?.message ?? null };
}

export async function cancelSalesOrderAction(salesOrderId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "sales_order.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_sales_order", {
    p_sales_order_id: salesOrderId,
    p_reason: reason,
  });
  revalidatePath(`/sales-orders/${salesOrderId}`);
  revalidatePath("/sales-orders");
  return { error: error?.message ?? null };
}
