"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ActionResult = { error: string | null; success?: boolean };

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

export async function updateCreditTermsAction(id: string, creditLimit: number, creditDays: number): Promise<ActionResult> {
  if (creditLimit < 0 || creditDays < 0) return { error: "Negative value nahi ho sakti." };
  const supabase = await createClient();
  const { error } = await supabase.from("parties").update({ credit_limit: creditLimit, credit_days: creditDays }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  return { error: null, success: true };
}
