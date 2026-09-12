"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { diffFields, smartMergeUpdate, type SmartMergeConflict } from "@/lib/smartMerge";

export type ActionResult = { error: string | null; success?: boolean; conflicts?: SmartMergeConflict[] };

export async function createPartyAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const legal_name = String(formData.get("legal_name") ?? "").trim();
  const party_type = String(formData.get("party_type") ?? "client");
  if (!legal_name) return { error: "Naam zaroori hai." };

  const { error } = await supabase.from("parties").insert({
    legal_name,
    party_type,
    ntn: String(formData.get("ntn") ?? "").trim() || null,
    strn: String(formData.get("strn") ?? "").trim() || null,
    cnic: String(formData.get("cnic") ?? "").trim() || null,
    billing_address: String(formData.get("billing_address") ?? "").trim() || null,
    province: String(formData.get("province") ?? "").trim() || null,
    credit_limit: Number(formData.get("credit_limit") ?? 0),
    credit_days: Number(formData.get("credit_days") ?? 0),
    created_by: user?.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/clients");
  return { error: null, success: true };
}

export async function togglePartyActiveAction(id: string, isActive: boolean) {
  const supabase = await createClient();
  await supabase.from("parties").update({ is_active: isActive }).eq("id", id);
  revalidatePath("/clients");
}

// Smart Merge: `base` is the credit_limit/credit_days this browser tab
// last loaded (i.e. what was on screen when the user opened this
// editor); only the fields that actually changed are sent as `changes`,
// so someone else's concurrent edit to the OTHER field never gets
// clobbered. If the same field was changed by someone else to a
// different value in the meantime, that one field comes back as a
// conflict for the user to resolve — everything else still saves.
export async function updateCreditTermsAction(
  id: string,
  base: { creditLimit: number; creditDays: number },
  next: { creditLimit: number; creditDays: number }
): Promise<ActionResult> {
  if (next.creditLimit < 0 || next.creditDays < 0) return { error: "Negative value nahi ho sakti." };

  const supabase = await createClient();
  const changes = diffFields(
    { credit_limit: base.creditLimit, credit_days: base.creditDays },
    { credit_limit: next.creditLimit, credit_days: next.creditDays }
  );
  const { result, error } = await smartMergeUpdate(
    supabase,
    "parties",
    id,
    { credit_limit: base.creditLimit, credit_days: base.creditDays },
    changes
  );
  if (error) return { error };
  if (result && result.conflicts.length > 0) {
    return { error: null, conflicts: result.conflicts };
  }

  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  return { error: null, success: true };
}
