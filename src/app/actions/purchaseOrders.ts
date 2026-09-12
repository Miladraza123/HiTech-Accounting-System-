"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

const NO_PERMISSION: ActionResult = { error: "You don't have permission to perform this action." };

export type PurchaseOrderLineInput = {
  item_id?: string;
  description: string;
  ordered_qty: number;
  unit?: string;
  rate: number;
  tax_pct: number;
};

export type ActionResult = { error: string | null; id?: string };

export async function createPurchaseOrderAction(input: {
  supplier_id: string;
  purchase_type: "direct" | "stock" | "general";
  linked_sales_order_id: string | null;
  warehouse_id: string | null;
  expected_delivery: string | null;
  lines: PurchaseOrderLineInput[];
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "purchase_order.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_purchase_order", {
    p_supplier_id: input.supplier_id,
    p_purchase_type: input.purchase_type,
    p_linked_sales_order_id: input.linked_sales_order_id as string,
    p_warehouse_id: input.warehouse_id as string,
    p_expected_delivery: input.expected_delivery as string,
    p_lines: input.lines,
  });
  if (error) return { error: error.message };
  revalidatePath("/purchase-orders");
  return { error: null, id: data as string };
}

export async function cancelPurchaseOrderAction(purchaseOrderId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "purchase_order.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_purchase_order", {
    p_purchase_order_id: purchaseOrderId,
    p_reason: reason,
  });
  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  revalidatePath("/purchase-orders");
  return { error: error?.message ?? null };
}

export type GrnLineInput = { po_line_id: string; this_receipt_qty: number };

export async function createGrnAction(input: {
  supplier_id: string;
  purchase_order_id: string;
  received_date: string;
  warehouse_id: string | null;
  remarks: string | null;
  lines: GrnLineInput[];
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "purchase_order.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_grn", {
    p_supplier_id: input.supplier_id,
    p_purchase_order_id: input.purchase_order_id,
    p_received_date: input.received_date,
    p_warehouse_id: input.warehouse_id as string,
    p_remarks: input.remarks as string,
    p_lines: input.lines,
  });
  revalidatePath(`/purchase-orders/${input.purchase_order_id}`);
  revalidatePath("/inventory");
  if (error) return { error: error.message };
  return { error: null, id: data as string };
}
