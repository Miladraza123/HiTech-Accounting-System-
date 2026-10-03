"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ActionResult = { error: string | null; success?: boolean };

export async function createDispatchGoAheadAction(deliveryChallanId: string, givenTo: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_create_dispatch_go_ahead", { p_delivery_challan_id: deliveryChallanId, p_given_to: givenTo });
  if (error) return { error: error.message };
  revalidatePath(`/delivery-challans/${deliveryChallanId}`);
  return { error: null, success: true };
}

export async function acceptDispatchGoAheadAction(goAheadId: string, deliveryChallanId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_accept_dispatch_go_ahead", { p_go_ahead_id: goAheadId });
  if (error) return { error: error.message };
  revalidatePath(`/delivery-challans/${deliveryChallanId}`);
  return { error: null, success: true };
}

export async function completeDispatchGoAheadAction(goAheadId: string, deliveryChallanId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_complete_dispatch_go_ahead", { p_go_ahead_id: goAheadId });
  if (error) return { error: error.message };
  revalidatePath(`/delivery-challans/${deliveryChallanId}`);
  return { error: null, success: true };
}

export async function markNotificationReadAction(notificationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_mark_notification_read", { p_notification_id: notificationId });
  if (error) return { error: error.message };
  return { error: null, success: true };
}
