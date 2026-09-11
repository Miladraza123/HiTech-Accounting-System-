"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ActionResult = { error: string | null; id?: string };

export type DeliveryChallanLineInput = {
  sales_order_line_id: string;
  delivered_qty: number;
  issue_from_stock: boolean;
};

export async function createDeliveryChallanAction(input: {
  sales_order_id: string;
  warehouse_id: string;
  delivery_date: string;
  vehicle_no: string | null;
  driver_name: string | null;
  remarks: string | null;
  lines: DeliveryChallanLineInput[];
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_delivery_challan", {
    p_sales_order_id: input.sales_order_id,
    p_warehouse_id: input.warehouse_id,
    p_delivery_date: input.delivery_date,
    p_vehicle_no: input.vehicle_no as string,
    p_driver_name: input.driver_name as string,
    p_remarks: input.remarks as string,
    p_lines: input.lines,
  });
  if (error) return { error: error.message };
  revalidatePath("/delivery-challans");
  revalidatePath("/inventory");
  return { error: null, id: data as string };
}

export async function recordPodAction(dcId: string, acceptedByName: string, note: string | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_record_pod", {
    p_dc_id: dcId,
    p_accepted_by_name: acceptedByName,
    p_note: note as string,
  });
  revalidatePath(`/delivery-challans/${dcId}`);
  return { error: error?.message ?? null };
}

export async function recordDisputeAction(dcId: string, note: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_record_dispute", { p_dc_id: dcId, p_note: note });
  revalidatePath(`/delivery-challans/${dcId}`);
  return { error: error?.message ?? null };
}

export async function cancelDeliveryChallanAction(dcId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_delivery_challan", { p_dc_id: dcId, p_reason: reason });
  revalidatePath(`/delivery-challans/${dcId}`);
  revalidatePath("/delivery-challans");
  revalidatePath("/inventory");
  return { error: error?.message ?? null };
}
