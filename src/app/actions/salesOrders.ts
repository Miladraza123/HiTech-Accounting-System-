"use server";

import { createClient } from "@/lib/supabase/server";
import { convertIncomingDocument } from "@/lib/incomingConversion";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { canSeeOrderCost } from "@/lib/orderCostAccess";
import { hasPermission } from "@/lib/permissions";

const NO_PERMISSION: ActionResult = { error: "You don't have permission to perform this action." };

export type SalesOrderLineInput = {
  id?: string;
  item_id?: string;
  description: string;
  ordered_qty: number;
  unit?: string;
  rate: number;
  tax_pct: number;
};

export type CreateSalesOrderInput = {
  quotation_id: string;
  client_po_number: string;
  po_date: string;
  delivery_schedule: string | null;
  payment_terms: string | null;
  business_line: string;
  lines: SalesOrderLineInput[];
  confirm_duplicate?: boolean;
  /** Set when reached from Incoming Documents' "PO Received" action — see the conversion block below. */
  from_incoming_document_id?: string;
  /** What we expect this order to cost us — only honoured for Owner/Accounts (see setEstimatedCost). */
  estimated_cost?: number | null;
};

export type ActionResult = { error: string | null; id?: string; warning?: string };

export async function createSalesOrderAction(input: CreateSalesOrderInput): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "sales_order.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_sales_order", {
    p_quotation_id: input.quotation_id,
    p_client_po_number: input.client_po_number,
    p_po_date: input.po_date,
    p_delivery_schedule: input.delivery_schedule as string,
    p_payment_terms: input.payment_terms as string,
    p_business_line: input.business_line,
    p_lines: input.lines,
    p_confirm_duplicate: input.confirm_duplicate ?? false,
  });

  if (error) return { error: error.message };
  const soId = data as string;
  revalidatePath("/sales-orders");
  const costWarning = await setEstimatedCost(supabase, user, soId, input.estimated_cost);

  // Converting an Incoming Document that turned out to be a PO (not a fresh
  // RFQ/PR — see src/components/PoQuotationPicker.tsx): carry its
  // attachment(s) over by copying the actual storage object, not
  // re-uploading, then mark it Converted so its own picker link can't be
  // reused on a second Sales Order. Best-effort, mirroring the same pattern
  // in createQueryAction — a copy failure must never lose the Sales Order
  // that was just saved. See convertIncomingDocument for the checks.
  if (input.from_incoming_document_id) {
    await convertIncomingDocument(supabase, {
      incomingDocumentId: input.from_incoming_document_id,
      ownerTable: "sales_orders",
      ownerId: soId,
      userId: user?.id,
    });
  }

  return { error: null, id: soId, warning: costWarning };
}

/**
 * Saves the optional estimated cost right after the order is created. It is a separate step on
 * purpose: a problem with the cost must never lose a saved order, so it only returns a warning.
 */
async function setEstimatedCost(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: Awaited<ReturnType<typeof getCurrentUser>>,
  salesOrderId: string,
  cost: number | null | undefined
): Promise<string | undefined> {
  if (cost === null || cost === undefined || !canSeeOrderCost(user)) return undefined;
  const { error } = await supabase.rpc("fn_set_sales_order_estimated_cost", { p_sales_order_id: salesOrderId, p_cost: cost });
  return error ? `The order was saved, but its estimated cost was not: ${error.message}` : undefined;
}

export type CreateDirectSalesOrderInput = {
  party_id: string;
  client_po_number: string;
  po_date: string;
  delivery_schedule: string | null;
  payment_terms: string | null;
  business_line: string;
  lines: SalesOrderLineInput[];
  confirm_duplicate?: boolean;
  estimated_cost?: number | null;
};

// For a client PO that arrives with no prior RFQ/Quotation at all (e.g. by
// WhatsApp or phone) — fn_create_direct_sales_order generates the Query +
// Quotation automatically so the Document Trail and the NOT NULL
// query_id/quotation_id on sales_orders stay intact, then creates the
// Sales Order exactly like the normal flow (same DUPLICATE_PO handling).
export async function createDirectSalesOrderAction(input: CreateDirectSalesOrderInput): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "sales_order.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_direct_sales_order", {
    p_party_id: input.party_id,
    p_client_po_number: input.client_po_number,
    p_po_date: input.po_date,
    p_delivery_schedule: input.delivery_schedule as string,
    p_payment_terms: input.payment_terms as string,
    p_business_line: input.business_line,
    p_lines: input.lines,
    p_confirm_duplicate: input.confirm_duplicate ?? false,
  });

  if (error) return { error: error.message };
  revalidatePath("/sales-orders");
  const costWarning = await setEstimatedCost(supabase, user, data as string, input.estimated_cost);
  return { error: null, id: data as string, warning: costWarning };
}

export async function amendSalesOrderAction(
  salesOrderId: string,
  reason: string,
  clientPoNumber: string,
  poDate: string,
  deliverySchedule: string | null,
  paymentTerms: string | null,
  lines: SalesOrderLineInput[]
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "sales_order.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_amend_sales_order", {
    p_sales_order_id: salesOrderId,
    p_reason: reason,
    p_client_po_number: clientPoNumber,
    p_po_date: poDate,
    p_delivery_schedule: deliverySchedule as string,
    p_payment_terms: paymentTerms as string,
    p_lines: lines,
  });
  revalidatePath(`/sales-orders/${salesOrderId}`);
  return { error: error?.message ?? null };
}

// A lightweight correction for a typo in the Client PO Number alone — no
// reason, no revision row, unlike amendSalesOrderAction above. client_po_number
// is a pure external reference (the client's own PO number) with no effect
// on accounting or stock, so it's safe to fix in one step via a narrow,
// single-column RPC (sales_orders has no general RLS update policy at all —
// see fn_update_sales_order_po_number's own migration comment).
export async function updateSalesOrderPoNumberAction(salesOrderId: string, poNumber: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_update_sales_order_po_number", {
    p_id: salesOrderId,
    p_po_number: poNumber,
  });
  if (error) return { error: error.message };
  revalidatePath(`/sales-orders/${salesOrderId}`);
  return { error: null };
}

export async function cancelSalesOrderAction(salesOrderId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "sales_order.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_sales_order", {
    p_sales_order_id: salesOrderId,
    p_reason: reason,
  });
  revalidatePath(`/sales-orders/${salesOrderId}`);
  revalidatePath("/sales-orders");
  return { error: error?.message ?? null };
}

/** Owner/Accounts: set or change the order's estimated cost (null clears it). */
export async function setSalesOrderEstimatedCostAction(salesOrderId: string, cost: number | null): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!canSeeOrderCost(user)) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_set_sales_order_estimated_cost", { p_sales_order_id: salesOrderId, p_cost: cost as number });
  if (error) return { error: error.message };
  revalidatePath(`/sales-orders/${salesOrderId}`);
  return { error: null, id: salesOrderId };
}
