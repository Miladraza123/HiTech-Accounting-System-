"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // Converting an Incoming Document (email RFQ/PR/PO — see
  // src/app/api/inbound-email/route.ts): carry its attachment(s) over by
  // copying the actual storage object, not re-uploading, then mark it
  // Converted so its own `?from=` link can't be reused on a second Query.
  // Best-effort, same as the attachment above — a copy failure must never
  // lose the Query that was just saved.
  const fromIncomingDocumentId = String(formData.get("from_incoming_document_id") ?? "") || null;
  if (fromIncomingDocumentId) {
    // The admin client, not the signed-in one: the source object lives
    // under "incoming/..." — a prefix the attachments bucket's own RLS
    // (fn_can_access_doc_type) was never taught to recognize, since it's
    // an unauthenticated webhook's own storage area, not a document type
    // any signed-in role already had read access to.
    const admin = createAdminClient();
    const { data: incomingAttachments } = await admin
      .from("incoming_document_attachments")
      .select("file_name, storage_path, content_type")
      .eq("incoming_document_id", fromIncomingDocumentId);
    for (const att of incomingAttachments ?? []) {
      const safeName = att.file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const newPath = `queries/${inserted.id}/${Date.now()}-${safeName}`;
      const { error: copyError } = await admin.storage.from("attachments").copy(att.storage_path, newPath);
      if (!copyError) {
        await admin.from("attachments").insert({
          owner_table: "queries",
          owner_id: inserted.id,
          file_path: newPath,
          file_type: att.content_type,
          label: null,
          uploaded_by: user?.id,
        });
      }
    }
    await admin
      .from("incoming_documents")
      .update({ status: "Converted", converted_query_id: inserted.id })
      .eq("id", fromIncomingDocumentId);
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
