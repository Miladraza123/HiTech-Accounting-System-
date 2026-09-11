"use server";

import { createClient } from "@/lib/supabase/server";
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
    return { error: "Client aur requirement zaroori hain." };
  }

  const { data: queryNo, error: numErr } = await supabase.rpc("fn_get_next_number", { p_doc_type: "QRY" });
  if (numErr || !queryNo) return { error: numErr?.message ?? "Query number nahi ban saka." };

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

  if (error || !inserted) return { error: error?.message ?? "Query save nahi hui." };

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
