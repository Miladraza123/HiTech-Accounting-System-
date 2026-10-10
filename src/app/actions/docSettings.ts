"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { isValidShortCode, normalizeShortCode } from "@/lib/docRef";

export type DocSettingsResult = { error: string | null; success?: boolean };

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const NO_PERMISSION: DocSettingsResult = { error: "You don't have permission to perform this action." };

/** Company-wide print settings: short code (HTE), name under the signature, FBR note on service invoices. */
export async function saveCompanyDocSettingsAction(_prev: DocSettingsResult, formData: FormData): Promise<DocSettingsResult> {
  if (!isOwner(await getCurrentUser())) return NO_PERMISSION;

  const shortCode = normalizeShortCode(String(formData.get("short_code") ?? ""));
  if (shortCode && !isValidShortCode(shortCode)) return { error: "Company code must be 2 to 10 letters or digits, like HTE." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("company")
    .update({
      short_code: shortCode || null,
      signatory_name: String(formData.get("signatory_name") ?? "").trim() || null,
      service_invoice_note: String(formData.get("service_invoice_note") ?? "").trim() || null,
    })
    .eq("id", COMPANY_ID);
  if (error) return { error: error.message };

  revalidatePath("/setup/company");
  return { error: null, success: true };
}

/** Per-client document settings: short code (TPFL) and what is required on that client's documents. */
export async function savePartyDocSettingsAction(_prev: DocSettingsResult, formData: FormData): Promise<DocSettingsResult> {
  const user = await getCurrentUser();
  if (!user) return NO_PERMISSION;

  const partyId = String(formData.get("party_id") ?? "");
  if (!partyId) return { error: "Client not found." };
  const shortCode = normalizeShortCode(String(formData.get("short_code") ?? ""));
  if (shortCode && !isValidShortCode(shortCode)) return { error: "Client code must be 2 to 10 letters or digits, like TPFL." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("parties")
    .update({
      short_code: shortCode || null,
      require_quotation_attn: formData.get("require_quotation_attn") === "on",
      require_invoice_po: formData.get("require_invoice_po") === "on",
    })
    .eq("id", partyId)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "You don't have permission to change this client." };

  revalidatePath(`/clients/${partyId}`);
  return { error: null, success: true };
}

/** Attn and Subject of a quotation. Attn is required when the client is set up that way. */
export async function updateQuotationHeaderAction(quotationId: string, attn: string, subject: string): Promise<DocSettingsResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "quotation.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data: q } = await supabase.from("quotations").select("party_id, parties(require_quotation_attn)").eq("id", quotationId).maybeSingle();
  if (!q) return { error: "Quotation not found." };
  const party = q.parties as unknown as { require_quotation_attn: boolean } | null;
  if (party?.require_quotation_attn && !attn.trim()) return { error: "Attn is required for this client." };

  const { data, error } = await supabase
    .from("quotations")
    .update({ attn: attn.trim() || null, subject: subject.trim() || null })
    .eq("id", quotationId)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "You don't have permission to change this quotation." };

  revalidatePath(`/quotations/${quotationId}`);
  return { error: null, success: true };
}
