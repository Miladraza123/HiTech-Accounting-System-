"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ActionResult = { error: string | null };

export async function requestStockAdjustmentAction(
  itemId: string,
  warehouseId: string,
  qtyDelta: number,
  reason: string
): Promise<ActionResult> {
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
