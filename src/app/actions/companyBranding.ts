"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export type ActionResult = { error: string | null; success?: boolean };

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";

export type BrandingKind = "logo" | "signature" | "stamp";

// These are small letterhead assets, not general attachments — a much
// tighter size cap than the attachments bucket's own 25MB limit, and
// restricted to actual image types (the print pages embed them as
// <img>, an SVG is fine too for a logo/stamp drawn as vector art).
const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

async function readCompanyColumn(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: BrandingKind
): Promise<string | null> {
  const { data } = await supabase.from("company").select("logo_path, signature_path, stamp_path").eq("id", COMPANY_ID).maybeSingle();
  if (!data) return null;
  if (kind === "logo") return data.logo_path;
  if (kind === "signature") return data.signature_path;
  return data.stamp_path;
}

async function writeCompanyColumn(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: BrandingKind,
  value: string | null
) {
  if (kind === "logo") return supabase.from("company").update({ logo_path: value }).eq("id", COMPANY_ID);
  if (kind === "signature") return supabase.from("company").update({ signature_path: value }).eq("id", COMPANY_ID);
  return supabase.from("company").update({ stamp_path: value }).eq("id", COMPANY_ID);
}

export async function uploadCompanyImageAction(kind: BrandingKind, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!isOwner(user)) return { error: "You don't have permission to perform this action." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No file selected." };
  if (!ALLOWED_TYPES.includes(file.type)) return { error: "Only PNG, JPEG, WEBP, or SVG images are allowed." };
  if (file.size > MAX_SIZE) return { error: "Image must be 2MB or smaller." };

  const supabase = await createClient();
  const previousPath = await readCompanyColumn(supabase, kind);

  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `company/${kind}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage.from("attachments").upload(path, file, { contentType: file.type });
  if (uploadError) return { error: uploadError.message };

  const { error: updateError } = await writeCompanyColumn(supabase, kind, path);
  if (updateError) {
    // Don't leave an orphaned file behind if the column update failed.
    await supabase.storage.from("attachments").remove([path]);
    return { error: updateError.message };
  }

  // Only after the new path is safely saved — never delete the old file
  // first, in case the upload/update above fails partway.
  if (previousPath && previousPath !== path) {
    await supabase.storage.from("attachments").remove([previousPath]);
  }

  revalidatePath("/setup/company");
  return { error: null, success: true };
}

export async function removeCompanyImageAction(kind: BrandingKind): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!isOwner(user)) return { error: "You don't have permission to perform this action." };

  const supabase = await createClient();
  const path = await readCompanyColumn(supabase, kind);

  const { error } = await writeCompanyColumn(supabase, kind, null);
  if (error) return { error: error.message };

  if (path) await supabase.storage.from("attachments").remove([path]);

  revalidatePath("/setup/company");
  return { error: null, success: true };
}

/** Short-lived preview URL for the Company Setup page's own upload UI (the attachments bucket is private). Print pages resolve their own signed URLs server-side directly — see src/lib/companyBranding.ts. */
export async function getCompanyImagePreviewUrlAction(path: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("attachments").createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data.signedUrl;
}
