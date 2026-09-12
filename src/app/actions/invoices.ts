"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export type ActionResult = { error: string | null; id?: string };

const NO_PERMISSION: ActionResult = { error: "You don't have permission to perform this action." };

export type InvoiceLineInput = {
  sales_order_line_id: string;
  qty: number;
  rate: number;
  tax_pct: number;
};

export async function createInvoiceAction(input: {
  sales_order_id: string;
  invoice_date: string;
  lines: InvoiceLineInput[];
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "invoice.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_invoice", {
    p_sales_order_id: input.sales_order_id,
    p_invoice_date: input.invoice_date,
    p_lines: input.lines,
  });
  if (error) return { error: error.message };
  revalidatePath("/invoices");
  return { error: null, id: data as string };
}

export async function cancelInvoiceAction(invoiceId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "invoice.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_invoice", { p_invoice_id: invoiceId, p_reason: reason });
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  return { error: error?.message ?? null };
}
