import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type OutstandingDocWithPo = {
  doc_id: string;
  doc_no: string;
  doc_date: string;
  outstanding_amount: number;
  po_no?: string | null;
};

/**
 * fn_party_outstanding doesn't carry sales_order_id (a supplier bill has
 * none), so the linked Direct-type Purchase Order shown next to a Receipt's
 * invoice — a reference only, the PO raised specifically to fulfil that
 * invoice's Sales Order — is found with the same reverse lookup the Invoice
 * detail page's own document trail uses: no invoice/SO row points forward to
 * it, so it's found by searching purchase_orders for this sales_order_id.
 * A no-op for Payments (to a supplier), which have no such reference.
 */
export async function attachPoRefs(
  supabase: SupabaseClient<Database>,
  direction: "receipt" | "payment",
  docs: { doc_id: string; doc_no: string; doc_date: string; outstanding_amount: number }[]
): Promise<OutstandingDocWithPo[]> {
  if (direction !== "receipt" || !docs.length) return docs;

  const docIds = docs.map((d) => d.doc_id);
  const { data: invoices } = await supabase.from("invoices").select("id, sales_order_id").in("id", docIds);
  const soIdByInvoiceId = new Map((invoices ?? []).map((i) => [i.id, i.sales_order_id]));
  const soIds = [...new Set((invoices ?? []).map((i) => i.sales_order_id).filter((v): v is string => !!v))];

  const { data: linkedPos } = soIds.length
    ? await supabase.from("purchase_orders").select("po_no, linked_sales_order_id").eq("purchase_type", "direct").in("linked_sales_order_id", soIds)
    : { data: [] };
  const poNoBySoId = new Map((linkedPos ?? []).map((p) => [p.linked_sales_order_id, p.po_no]));

  return docs.map((d) => {
    const soId = soIdByInvoiceId.get(d.doc_id);
    return { ...d, po_no: soId ? poNoBySoId.get(soId) ?? null : null };
  });
}
