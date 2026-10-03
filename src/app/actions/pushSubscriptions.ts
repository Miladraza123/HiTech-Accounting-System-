"use server";

import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error: string | null; success?: boolean };

export async function saveSubscriptionAction(endpoint: string, p256dh: string, auth: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // endpoint is unique — re-enabling on the same device upserts in place
  // instead of piling up a dead row every time a key happens to rotate.
  const { error } = await supabase.from("push_subscriptions").upsert({ user_id: user.id, endpoint, p256dh, auth }, { onConflict: "endpoint" });
  if (error) return { error: error.message };
  return { error: null, success: true };
}

export async function removeSubscriptionAction(endpoint: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return { error: error.message };
  return { error: null, success: true };
}
