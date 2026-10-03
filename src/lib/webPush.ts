import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails("mailto:no-reply@hitech-erp.local", publicKey, privateKey);
  configured = true;
  return true;
}

export type PushPayload = { title: string; body: string; href: string };

/**
 * Sends an OS-level push notification to every device a user has
 * subscribed on (several are possible — phone + desktop). Uses the admin
 * client because the caller (a server action, already behind its own
 * permission check — e.g. the dispatch RPC that just decided who the
 * recipient is) needs another user's subscription rows, which that
 * user's own RLS policy (`user_id = auth.uid()`) would never allow a
 * different session to read.
 *
 * Silently does nothing if VAPID keys aren't configured (push is an
 * enhancement — the in-app/persisted notification already landed
 * regardless) or if the user has no subscriptions. A 404/410 from the
 * push service means that device unsubscribed or the subscription
 * expired — its row is deleted rather than retried.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;

  const admin = createAdminClient();
  const { data: subscriptions } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  if (!subscriptions?.length) return;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    })
  );
}
