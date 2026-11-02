"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export type ActionResult = { error: string | null; id?: string; warning?: string };

const NO_PERMISSION: ActionResult = { error: "You don't have permission to perform this action." };

export type InvoiceLineInput = {
  sales_order_line_id: string;
  qty: number;
  rate: number;
  tax_pct: number;
  hs_code?: string;
  /** Wording for this invoice line; omitted/blank = keep the Sales Order line's own description. */
  description?: string;
};

/** The printed header facts of a GST invoice. All optional; blank means "not printed". */
export type InvoiceDetailsInput = {
  dc_refs: string;
  payment_terms: string;
  due_date: string | null;
  contact_person: string;
  total_weight: string;
  print_note: string;
};

function hasAnyDetail(d: InvoiceDetailsInput | undefined): d is InvoiceDetailsInput {
  return !!d && !!(d.dc_refs.trim() || d.payment_terms.trim() || d.due_date || d.contact_person.trim() || d.total_weight.trim() || d.print_note.trim());
}

async function saveInvoiceDetails(supabase: Awaited<ReturnType<typeof createClient>>, invoiceId: string, d: InvoiceDetailsInput) {
  return supabase.rpc("fn_set_invoice_details", {
    p_invoice_id: invoiceId,
    p_dc_refs: d.dc_refs,
    p_payment_terms: d.payment_terms,
    p_due_date: d.due_date as string,
    p_contact_person: d.contact_person,
    p_total_weight: d.total_weight,
    p_print_note: d.print_note,
  });
}

export async function createInvoiceAction(input: {
  sales_order_id: string;
  invoice_date: string;
  lines: InvoiceLineInput[];
  invoice_no?: string;
  details?: InvoiceDetailsInput;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "invoice.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_invoice", {
    p_sales_order_id: input.sales_order_id,
    p_invoice_date: input.invoice_date,
    p_lines: input.lines,
    p_invoice_no: (input.invoice_no ?? null) as string,
  });
  if (error) return { error: error.message };
  revalidatePath("/invoices");

  // A separate step on purpose: a problem with a print detail must never lose a posted invoice,
  // so it only comes back as a warning (the details can be fixed on the invoice page).
  let warning: string | undefined;
  if (hasAnyDetail(input.details)) {
    const { error: detailsError } = await saveInvoiceDetails(supabase, data as string, input.details);
    if (detailsError) warning = `The invoice was saved, but its print details were not: ${detailsError.message}`;
  }
  return { error: null, id: data as string, warning };
}

/** Owner/Accounts: change the printed details (D.C #, terms, due date, contact, weight, note) of a Posted invoice. */
export async function updateInvoiceDetailsAction(invoiceId: string, details: InvoiceDetailsInput): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "invoice.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await saveInvoiceDetails(supabase, invoiceId, details);
  if (error) return { error: error.message };
  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null, id: invoiceId };
}

export type InvoiceNumberOption = { invoice_no: string; kind: "sequential" | "reclaimed" };

// The picker behind the two cancelled-number cases: a trailing cancellation
// (nothing created after it) and a cancellation after a later number
// already exists — both are just "available numbers", offered alongside
// the normal next-sequential one, letting Owner/Accounts choose either way.
export async function getAvailableInvoiceNumbersAction(): Promise<InvoiceNumberOption[]> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "invoice.manage"))) return [];

  const supabase = await createClient();
  const { data } = await supabase.rpc("fn_get_available_invoice_numbers");
  return (data ?? []) as InvoiceNumberOption[];
}

export async function cancelInvoiceAction(invoiceId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!isOwner(user)) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_invoice", { p_invoice_id: invoiceId, p_reason: reason });
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  return { error: error?.message ?? null };
}

export async function updateInvoiceLineDescriptionAction(invoiceLineId: string, invoiceId: string, description: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "invoice.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_update_invoice_line_description", {
    p_invoice_line_id: invoiceLineId,
    p_description: description,
  });
  if (error) return { error: error.message };
  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null, id: invoiceId };
}
