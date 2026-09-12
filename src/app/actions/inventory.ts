"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export type ActionResult = { error: string | null };

const NO_PERMISSION: ActionResult = { error: "You don't have permission to perform this action." };

export async function requestStockAdjustmentAction(
  itemId: string,
  warehouseId: string,
  qtyDelta: number,
  reason: string
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "inventory_adjustment.request"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_request_stock_adjustment", {
    p_item_id: itemId,
    p_warehouse_id: warehouseId,
    p_qty_delta: qtyDelta,
    p_reason: reason,
  });
  revalidatePath("/inventory/adjustments");
  return { error: error?.message ?? null };
}

export async function approveStockAdjustmentAction(adjustmentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_approve_stock_adjustment", { p_adjustment_id: adjustmentId });
  revalidatePath("/inventory/adjustments");
  revalidatePath("/inventory");
  return { error: error?.message ?? null };
}

export async function rejectStockAdjustmentAction(adjustmentId: string, note: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_reject_stock_adjustment", {
    p_adjustment_id: adjustmentId,
    p_note: note,
  });
  revalidatePath("/inventory/adjustments");
  return { error: error?.message ?? null };
}
