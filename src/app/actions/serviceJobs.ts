"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { smartMergeUpdate } from "@/lib/smartMerge";
import { hasPermission } from "@/lib/permissions";
import type { Json } from "@/lib/supabase/database.types";

export type ActionResult = { error: string | null; id?: string; success?: boolean };

const NO_PERMISSION: ActionResult = { error: "You don't have permission to perform this action." };

export type ServiceInvoiceLineInput = { description: string; qty: number; rate: number; tax_pct: number };

export async function createServiceJobAction(input: {
  party_id: string;
  asset_description: string;
  customer_dc_no: string | null;
  customer_dc_date: string | null;
  received_condition_notes: string | null;
  client_po_no: string;
}): Promise<ActionResult> {
  const poNo = input.client_po_no.trim();
  if (!poNo) return { error: "Client PO number is required." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_service_job", {
    p_party_id: input.party_id,
    p_asset_description: input.asset_description,
    p_customer_dc_no: input.customer_dc_no as string,
    p_customer_dc_date: input.customer_dc_date as string,
    p_received_condition_notes: input.received_condition_notes as string,
  });
  if (error) return { error: error.message };
  // The PO number lives on the job row itself (the RPC above has no parameter for it).
  await supabase.from("service_jobs").update({ client_po_no: poNo }).eq("id", data as string);
  revalidatePath("/service-jobs");
  return { error: null, id: data as string, success: true };
}

// customer_dc_no (the client's own delivery-challan number) is a pure
// external memo with no accounting effect — a typo fix via Smart Merge,
// same pattern as Party credit terms, rather than Cancel+recreate.
export async function updateServiceJobDcNoAction(serviceJobId: string, currentDcNo: string | null, nextDcNo: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { result, error } = await smartMergeUpdate(
    supabase,
    "service_jobs",
    serviceJobId,
    { customer_dc_no: currentDcNo },
    { customer_dc_no: nextDcNo || null }
  );
  if (error) return { error: error.message };
  if (result && result.conflicts.length > 0) return { error: "This was just changed by someone else — reopen and try again." };
  revalidatePath(`/service-jobs/${serviceJobId}`);
  return { error: null, success: true };
}

export async function completeServiceJobAction(serviceJobId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_complete_service_job", { p_service_job_id: serviceJobId });
  if (error) return { error: error.message };
  revalidatePath(`/service-jobs/${serviceJobId}`);
  revalidatePath("/service-jobs");
  return { error: null, success: true };
}

export async function cancelServiceJobAction(serviceJobId: string, reason: string): Promise<ActionResult> {
  if (!isOwner(await getCurrentUser())) return NO_PERMISSION;
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_service_job", { p_service_job_id: serviceJobId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath(`/service-jobs/${serviceJobId}`);
  revalidatePath("/service-jobs");
  return { error: null, success: true };
}

export async function createServiceDeliveryAction(input: {
  service_job_id: string;
  delivery_date: string | null;
  vehicle_no: string | null;
  driver_name: string | null;
  remarks: string | null;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_service_delivery", {
    p_service_job_id: input.service_job_id,
    p_delivery_date: input.delivery_date as string,
    p_vehicle_no: input.vehicle_no as string,
    p_driver_name: input.driver_name as string,
    p_remarks: input.remarks as string,
  });
  if (error) return { error: error.message };
  revalidatePath(`/service-jobs/${input.service_job_id}`);
  return { error: null, id: data as string, success: true };
}

export async function cancelServiceDeliveryAction(serviceDeliveryId: string, serviceJobId: string, reason: string): Promise<ActionResult> {
  if (!isOwner(await getCurrentUser())) return NO_PERMISSION;
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_service_delivery", { p_service_delivery_id: serviceDeliveryId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath(`/service-jobs/${serviceJobId}`);
  return { error: null, success: true };
}

export async function createServiceInvoiceAction(
  serviceJobId: string,
  invoiceDate: string | null,
  lines: ServiceInvoiceLineInput[],
  clientPoNo: string | null = null
): Promise<ActionResult> {
  const supabase = await createClient();

  // The client's PO number comes from the Service Job. An older job without one
  // takes it here, and it is saved onto the job too.
  const { data: job } = await supabase.from("service_jobs").select("client_po_no").eq("id", serviceJobId).maybeSingle();
  const poNo = job?.client_po_no?.trim() || clientPoNo?.trim() || null;
  if (!poNo) return { error: "Client PO number is required." };

  const { data, error } = await supabase.rpc("fn_create_service_invoice", {
    p_service_job_id: serviceJobId,
    p_invoice_date: invoiceDate as string,
    p_lines: lines,
  });
  if (error) return { error: error.message };
  await supabase.from("service_invoices").update({ client_po_no: poNo }).eq("id", data as string);
  if (!job?.client_po_no) await supabase.from("service_jobs").update({ client_po_no: poNo }).eq("id", serviceJobId);
  revalidatePath(`/service-jobs/${serviceJobId}`);
  return { error: null, id: data as string, success: true };
}

export async function cancelServiceInvoiceAction(serviceInvoiceId: string, serviceJobId: string, reason: string): Promise<ActionResult> {
  if (!isOwner(await getCurrentUser())) return NO_PERMISSION;
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_service_invoice", { p_service_invoice_id: serviceInvoiceId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath(`/service-jobs/${serviceJobId}`);
  return { error: null, success: true };
}

// ---------------------------------------------------------------------------
// Material issued to a Service Job (Site Material DC) and sent back
// ---------------------------------------------------------------------------
export async function createServiceMaterialDocAction(input: {
  service_job_id: string;
  kind: "issue" | "return";
  warehouse_id: string;
  doc_date: string;
  vehicle_no: string;
  driver_name: string;
  remarks: string;
  lines: { item_id: string; qty: number }[];
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "service_material.manage"))) return NO_PERMISSION;
  if (!input.warehouse_id) return { error: "Choose a warehouse." };
  if (!input.lines.length) return { error: "Add at least one item." };
  for (const l of input.lines) {
    if (!l.item_id) return { error: "Choose an item on every line." };
    if (!Number.isFinite(l.qty) || l.qty <= 0) return { error: "Quantity must be more than zero." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_service_material_doc", {
    p_service_job_id: input.service_job_id,
    p_kind: input.kind,
    p_warehouse_id: input.warehouse_id,
    p_doc_date: input.doc_date as string,
    p_vehicle_no: input.vehicle_no as string,
    p_driver_name: input.driver_name as string,
    p_remarks: input.remarks as string,
    p_lines: input.lines as unknown as Json,
  });
  if (error) return { error: error.message };
  revalidatePath(`/service-jobs/${input.service_job_id}`);
  return { error: null, id: data as string, success: true };
}

export async function cancelServiceMaterialDocAction(docId: string, serviceJobId: string, reason: string): Promise<ActionResult> {
  if (!isOwner(await getCurrentUser())) return { error: "Only the Owner can cancel a material document." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_service_material_doc", { p_doc_id: docId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath(`/service-jobs/${serviceJobId}`);
  return { error: null, success: true };
}
