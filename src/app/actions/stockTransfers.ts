"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export type ActionResult = { error: string | null; id?: string };

const NO_PERMISSION: ActionResult = { error: "Aap ke paas yeh action karne ki ijazat nahi hai." };

export type StockTransferLineInput = { item_id: string; qty: number };

export async function createStockTransferAction(input: {
  from_warehouse_id: string;
  to_warehouse_id: string;
  transfer_date: string;
  remarks: string | null;
  lines: StockTransferLineInput[];
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "stock_transfer.create"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_stock_transfer", {
    p_from_warehouse_id: input.from_warehouse_id,
    p_to_warehouse_id: input.to_warehouse_id,
    p_transfer_date: input.transfer_date,
    p_remarks: input.remarks,
    p_lines: input.lines,
  });
  if (error) return { error: error.message };
  revalidatePath("/stock-transfers");
  revalidatePath("/inventory");
  return { error: null, id: data as string };
}

export async function cancelStockTransferAction(transferId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "stock_transfer.create"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_stock_transfer", { p_transfer_id: transferId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath("/stock-transfers");
  revalidatePath(`/stock-transfers/${transferId}`);
  revalidatePath("/inventory");
  return { error: null };
}
