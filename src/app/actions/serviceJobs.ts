"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { revalidatePath } from "next/cache";

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
