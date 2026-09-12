"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function uploadAttachmentAction(
  ownerTable: string,
  ownerId: string,
  revalidateTo: string,
  formData: FormData
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Login is required." };

  const file = formData.get("file") as File | null;
  const label = String(formData.get("label") ?? "").trim() || null;
  if (!file || file.size === 0) return { error: "No file found." };

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${ownerTable}/${ownerId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("attachments")
    .upload(path, file, { contentType: file.type || undefined });

  if (uploadError) return { error: uploadError.message };

  const { error: insertError } = await supabase.from("attachments").insert({
    owner_table: ownerTable,
    owner_id: ownerId,
    file_path: path,
    file_type: file.type || null,
    label,
    uploaded_by: user.id,
  });

  if (insertError) return { error: insertError.message };

  revalidatePath(revalidateTo);
  return { error: null };
}

export async function getAttachmentUrlAction(path: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("attachments").createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data.signedUrl;
}

export async function deleteAttachmentAction(id: string, path: string, revalidateTo: string) {
  const supabase = await createClient();
  await supabase.storage.from("attachments").remove([path]);
  await supabase.from("attachments").delete().eq("id", id);
  revalidatePath(revalidateTo);
}
