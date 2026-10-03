"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ActionResult = { error: string | null; id?: string; success?: boolean };

export type ServiceInvoiceLineInput = { description: string; qty: number; rate: number; tax_pct: number };

export async function createServiceJobAction(input: {
  party_id: string;
  asset_description: string;
  customer_dc_no: string | null;
  customer_dc_date: string | null;
  received_condition_notes: string | null;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_service_job", {
    p_party_id: input.party_id,
    p_asset_description: input.asset_description,
    p_customer_dc_no: input.customer_dc_no as string,
    p_customer_dc_date: input.customer_dc_date as string,
    p_received_condition_notes: input.received_condition_notes as string,
  });
  if (error) return { error: error.message };
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
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_service_delivery", { p_service_delivery_id: serviceDeliveryId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath(`/service-jobs/${serviceJobId}`);
  return { error: null, success: true };
}

export async function createServiceInvoiceAction(
  serviceJobId: string,
  invoiceDate: string | null,
  lines: ServiceInvoiceLineInput[]
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_service_invoice", {
    p_service_job_id: serviceJobId,
    p_invoice_date: invoiceDate as string,
    p_lines: lines,
  });
  if (error) return { error: error.message };
  revalidatePath(`/service-jobs/${serviceJobId}`);
  return { error: null, id: data as string, success: true };
}

export async function cancelServiceInvoiceAction(serviceInvoiceId: string, serviceJobId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_service_invoice", { p_service_invoice_id: serviceInvoiceId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath(`/service-jobs/${serviceJobId}`);
  return { error: null, success: true };
}
