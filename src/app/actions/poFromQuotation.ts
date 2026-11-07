"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type { Json } from "@/lib/supabase/database.types";

export type PoLineInput = {
  quotation_line_id: string;
  line_type: "material" | "fabrication" | "service";
  item_id?: string;
  description: string;
  qty: number;
  unit?: string;
  rate: number;
  tax_pct: number;
};

export type PoResult = { material_so_id: string | null; fabrication_so_id: string | null; service_job_id: string | null };

/**
 * A client PO for a quotation that mixes Material, Fabrication and Service lines: one call creates
 * the Material Sales Order, the Fabrication Sales Order and the Service Job (whichever have lines),
 * all with the same PO number. The database function does the work with the existing order and
 * service-job functions; see supabase/migrations/20261108100000_phase59_01_po_from_quotation.sql.
 */
export async function createPoFromQuotationAction(input: {
  quotation_id: string;
  client_po_number: string;
  po_date: string;
  delivery_schedule: string | null;
  payment_terms: string | null;
  lines: PoLineInput[];
  confirm_duplicate?: boolean;
}): Promise<{ error: string | null; result?: PoResult }> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "sales_order.manage"))) return { error: "You don't have permission to perform this action." };
  if (!input.client_po_number.trim()) return { error: "Client PO Number is required." };
  if (!input.lines.length) return { error: "Choose at least one line." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_po_from_quotation", {
    p_quotation_id: input.quotation_id,
    p_client_po_number: input.client_po_number.trim(),
    p_po_date: input.po_date,
    p_delivery_schedule: input.delivery_schedule as string,
    p_payment_terms: input.payment_terms as string,
    p_lines: input.lines as unknown as Json,
    p_confirm_duplicate: input.confirm_duplicate ?? false,
  });
  if (error) return { error: error.message };

  revalidatePath("/sales-orders");
  revalidatePath("/service-jobs");
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${input.quotation_id}`);
  return { error: null, result: data as unknown as PoResult };
}
