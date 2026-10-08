"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { convertIncomingDocument } from "@/lib/incomingConversion";
import { sendPushToUser } from "@/lib/webPush";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type ActionResult = { error: string | null };

export async function createQueryAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const party_id = String(formData.get("party_id") ?? "");
  const requirement = String(formData.get("requirement") ?? "").trim();
  const source = String(formData.get("source") ?? "") || null;
  const query_date = String(formData.get("query_date") ?? "") || new Date().toISOString().slice(0, 10);
  const next_followup_at = String(formData.get("next_followup_at") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!party_id || !requirement) {
    return { error: "Client and requirement are required." };
  }

  const { data: queryNo, error: numErr } = await supabase.rpc("fn_get_next_number", { p_doc_type: "QRY" });
  if (numErr || !queryNo) return { error: numErr?.message ?? "Failed to generate Query number." };

  const { data: inserted, error } = await supabase
    .from("queries")
    .insert({
      query_no: queryNo,
      query_date,
      party_id,
      requirement,
      source,
      responsible_user_id: user?.id,
      next_followup_at,
      notes,
      created_by: user?.id,
    })
    .select("id")
    .single();

  if (error || !inserted) return { error: error?.message ?? "Failed to save Query." };

  // Optional first-document attachment (e.g. the client's drawing/email
  // screenshot) — reuses the exact same Storage bucket + `attachments`
  // table the detail page's AttachmentsPanel writes to, so it shows up
  // there immediately. Best-effort: a failed upload must never lose the
  // Query that was just saved — the user can still attach it afterwards
  // from the detail page.
  const attachment = formData.get("attachment") as File | null;
  if (attachment && attachment.size > 0) {
    const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `queries/${inserted.id}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("attachments")
      .upload(path, attachment, { contentType: attachment.type || undefined });
    if (!uploadError) {
      await supabase.from("attachments").insert({
        owner_table: "queries",
        owner_id: inserted.id,
        file_path: path,
        file_type: attachment.type || null,
        label: null,
        uploaded_by: user?.id,
      });
    }
  }

  // Converting an Incoming Document: copy its attachment(s) over and mark
  // it Converted so its own `?from=` link can't be reused on a second Query.
  // See convertIncomingDocument for the ownership/visibility checks.
  const fromIncomingDocumentId = String(formData.get("from_incoming_document_id") ?? "") || null;
  if (fromIncomingDocumentId) {
    await convertIncomingDocument(supabase, {
      incomingDocumentId: fromIncomingDocumentId,
      ownerTable: "queries",
      ownerId: inserted.id,
      userId: user?.id,
    });
  }

  redirect(`/queries/${inserted.id}`);
}

export async function addActivityNoteAction(
  ownerTable: string,
  ownerId: string,
  note: string,
  nextFollowupAt: string | null,
  revalidateTo: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await supabase.from("activity_timeline").insert({
    owner_table: ownerTable,
    owner_id: ownerId,
    event_type: "note",
    note,
    actor_id: user?.id,
    next_followup_at: nextFollowupAt,
  });

  if (nextFollowupAt && ownerTable === "queries") {
    await supabase.from("queries").update({ next_followup_at: nextFollowupAt }).eq("id", ownerId);
  }

  revalidatePath(revalidateTo);
}

export async function setQueryStatusAction(queryId: string, status: string, note: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_set_query_status", {
    p_query_id: queryId,
    p_status: status,
    p_note: note as string,
  });
  revalidatePath(`/queries/${queryId}`);
  revalidatePath("/queries");
  return { error: error?.message ?? null };
}

// Office -> Engineer/Rider costing hand-off (Phase 46.05) — mirrors
// Dispatch Go-Ahead's exact Accept/Complete + notification shape. Each RPC
// inserts exactly one notifications row per call; fetching it back here
// (with the admin client, since the row belongs to the RECIPIENT and
// notifications' own RLS hides it from the sender) is what lets the push
// payload and the in-app bell always say the same thing. Push is
// best-effort — a missing service-role key, or any push failure, never
// fails the action, since the in-app notification row already landed.
async function pushLatestQueryNotification(queryId: string, type: string) {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("notifications")
      .select("recipient_user_id, title, description, href")
      .eq("related_table", "queries")
      .eq("related_id", queryId)
      .eq("type", type)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return;
    await sendPushToUser(data.recipient_user_id, { title: data.title, body: data.description ?? "", href: data.href ?? "/" });
  } catch {
    // The in-app notification row already landed; push is an enhancement.
  }
}

export async function createQueryAssignmentAction(queryId: string, assignedTo: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_create_query_assignment", { p_query_id: queryId, p_assigned_to: assignedTo });
  if (error) return { error: error.message };
  await pushLatestQueryNotification(queryId, "query_assigned");
  revalidatePath(`/queries/${queryId}`);
  return { error: null };
}

export async function acceptQueryAssignmentAction(assignmentId: string, queryId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_accept_query_assignment", { p_assignment_id: assignmentId });
  if (error) return { error: error.message };
  await pushLatestQueryNotification(queryId, "query_assignment_accepted");
  revalidatePath(`/queries/${queryId}`);
  return { error: null };
}

export async function completeQueryAssignmentAction(assignmentId: string, queryId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_complete_query_assignment", { p_assignment_id: assignmentId });
  if (error) return { error: error.message };
  await pushLatestQueryNotification(queryId, "query_assignment_completed");
  revalidatePath(`/queries/${queryId}`);
  return { error: null };
}
