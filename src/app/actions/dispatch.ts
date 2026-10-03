"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { sendPushToUser } from "@/lib/webPush";

export type ActionResult = { error: string | null; success?: boolean };

// Each dispatch RPC inserts exactly one notifications row per call (see
// the migration) — fetching it back here, instead of duplicating its
// title/description/href, is what lets the push payload and the in-app
// bell always say exactly the same thing.
async function pushLatestNotification(supabase: Awaited<ReturnType<typeof createClient>>, deliveryChallanId: string, type: string) {
  const { data } = await supabase
    .from("notifications")
    .select("recipient_user_id, title, description, href")
    .eq("related_table", "delivery_challans")
    .eq("related_id", deliveryChallanId)
    .eq("type", type)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return;
  await sendPushToUser(data.recipient_user_id, { title: data.title, body: data.description ?? "", href: data.href ?? "/" });
}

export async function createDispatchGoAheadAction(deliveryChallanId: string, givenTo: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_create_dispatch_go_ahead", { p_delivery_challan_id: deliveryChallanId, p_given_to: givenTo });
  if (error) return { error: error.message };
  await pushLatestNotification(supabase, deliveryChallanId, "dispatch_go_ahead_received");
  revalidatePath(`/delivery-challans/${deliveryChallanId}`);
  return { error: null, success: true };
}

export async function acceptDispatchGoAheadAction(goAheadId: string, deliveryChallanId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_accept_dispatch_go_ahead", { p_go_ahead_id: goAheadId });
  if (error) return { error: error.message };
  await pushLatestNotification(supabase, deliveryChallanId, "dispatch_go_ahead_accepted");
  revalidatePath(`/delivery-challans/${deliveryChallanId}`);
  return { error: null, success: true };
}

export async function completeDispatchGoAheadAction(goAheadId: string, deliveryChallanId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_complete_dispatch_go_ahead", { p_go_ahead_id: goAheadId });
  if (error) return { error: error.message };
  await pushLatestNotification(supabase, deliveryChallanId, "dispatch_go_ahead_completed");
  revalidatePath(`/delivery-challans/${deliveryChallanId}`);
  return { error: null, success: true };
}

export async function markNotificationReadAction(notificationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_mark_notification_read", { p_notification_id: notificationId });
  if (error) return { error: error.message };
  return { error: null, success: true };
}
