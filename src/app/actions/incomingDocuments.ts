"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

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
