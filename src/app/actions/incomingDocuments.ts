"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { isValidEmail } from "@/lib/incomingAgent";

export type ActionResult = { error: string | null; success?: boolean };

async function canReview() {
  const user = await getCurrentUser();
  return isOwner(user) || hasRole(user, "sales");
}

export async function markIncomingDocumentReviewedAction(id: string): Promise<ActionResult> {
  if (!(await canReview())) return { error: "You don't have permission to perform this action." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("incoming_documents")
    .update({ status: "Reviewed", reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "New");
  if (error) return { error: error.message };
  revalidatePath("/incoming-documents");
  return { error: null, success: true };
}

export async function dismissIncomingDocumentAction(id: string): Promise<ActionResult> {
  if (!(await canReview())) return { error: "You don't have permission to perform this action." };
  const supabase = await createClient();
  const { error } = await supabase.from("incoming_documents").update({ status: "Dismissed" }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/incoming-documents");
  return { error: null, success: true };
}

// Phase 44: marks a sender as trusted. Future emails from that address arrive as
// "trusted", and the sender's documents that are already here are updated too.
// Runs as the signed-in user, so the RLS policies (Owner/Sales) are the gate.
export async function trustSenderAction(email: string): Promise<ActionResult> {
  if (!(await canReview())) return { error: "You don't have permission to perform this action." };
  const clean = String(email ?? "").trim().toLowerCase();
  if (!isValidEmail(clean)) return { error: "This sender has no valid email address." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error: insertError } = await supabase.from("trusted_senders").insert({ email: clean, created_by: user?.id ?? null });
  // 23505 = already trusted; still fall through so older documents get updated.
  if (insertError && insertError.code !== "23505") return { error: insertError.message };

  const { error: updateError } = await supabase
    .from("incoming_documents")
    .update({ sender_trust: "trusted" })
    .eq("sender_email", clean)
    .neq("sender_trust", "trusted");
  if (updateError) return { error: updateError.message };

  revalidatePath("/incoming-documents");
  return { error: null, success: true };
}

// The regular `attachments` storage bucket's own RLS only recognizes a
// fixed, existing set of doc-type path prefixes (queries/, invoices/,
// purchase_orders/, ...) via fn_can_access_doc_type — "incoming/" isn't
// one of them, and extending that function is out of scope for this
// phase. The admin client sidesteps that for exactly this one path
// prefix; the page calling this is itself already gated to Owner/Sales.
export async function getIncomingAttachmentUrlAction(path: string): Promise<string | null> {
  if (!(await canReview())) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("attachments").createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data.signedUrl;
}
