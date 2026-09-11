"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type QuotationLineInput = {
  item_id?: string;
  description: string;
  qty: number;
  unit?: string;
  rate: number;
  tax_pct: number;
};

export type ActionResult = { error: string | null };

function readLinesFromForm(formData: FormData): QuotationLineInput[] {
  const raw = String(formData.get("lines_json") ?? "[]");
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export async function createQuotationAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const query_id = String(formData.get("query_id") ?? "");
  const terms = String(formData.get("terms") ?? "").trim() || null;
  const validity_date = String(formData.get("validity_date") ?? "") || null;
  const delivery_terms = String(formData.get("delivery_terms") ?? "").trim() || null;
  const payment_terms = String(formData.get("payment_terms") ?? "").trim() || null;
  const lines = readLinesFromForm(formData);

  if (!query_id) return { error: "Query select karen." };
  if (!lines.length) return { error: "Kam az kam ek item/service add karen." };

  const { data, error } = await supabase.rpc("fn_create_quotation", {
    p_query_id: query_id,
    p_terms: terms as string,
    p_validity_date: validity_date as string,
    p_delivery_terms: delivery_terms as string,
    p_payment_terms: payment_terms as string,
    p_lines: lines,
  });

  if (error || !data) return { error: error?.message ?? "Quotation nahi ban saki." };

  redirect(`/quotations/${data}`);
}

export async function updateDraftQuotationAction(
  quotationId: string,
  terms: string | null,
  validityDate: string | null,
  deliveryTerms: string | null,
  paymentTerms: string | null,
  lines: QuotationLineInput[]
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_update_draft_quotation", {
    p_quotation_id: quotationId,
    p_terms: terms as string,
    p_validity_date: validityDate as string,
    p_delivery_terms: deliveryTerms as string,
    p_payment_terms: paymentTerms as string,
    p_lines: lines,
  });
  revalidatePath(`/quotations/${quotationId}`);
  return { error: error?.message ?? null };
}

export async function markQuotationSentAction(quotationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_mark_quotation_sent", { p_quotation_id: quotationId });
  revalidatePath(`/quotations/${quotationId}`);
  return { error: error?.message ?? null };
}

export async function createQuotationRevisionAction(
  quotationId: string,
  reason: string,
  terms: string | null,
  validityDate: string | null,
  deliveryTerms: string | null,
  paymentTerms: string | null,
  lines: QuotationLineInput[]
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_create_quotation_revision", {
    p_quotation_id: quotationId,
    p_reason: reason,
    p_terms: terms as string,
    p_validity_date: validityDate as string,
    p_delivery_terms: deliveryTerms as string,
    p_payment_terms: paymentTerms as string,
    p_lines: lines,
  });
  revalidatePath(`/quotations/${quotationId}`);
  return { error: error?.message ?? null };
}
