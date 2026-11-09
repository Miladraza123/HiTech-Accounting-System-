"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type { Json } from "@/lib/supabase/database.types";

export type ActionResult = { error: string | null; id?: string; success?: boolean };

export type SiteMaterialLineInput = {
  /** true: a stock item (stock moves). false: a custom item (typed name, no stock, cost typed in). */
  is_stock: boolean;
  item_id?: string;
  custom_name?: string;
  qty: number;
  unit?: string;
  /** Custom items only: cost per unit (shown on the job, never posted to the accounts). */
  unit_cost?: number;
  /** This line's own description (printed in the Remarks column). */
  description?: string;
};

/**
 * Raw Material DC (Site Material DC) for a Service Job (serviceJobId) or a Fabrication Job (jobId): issue
 * material to site, or record material coming back. Stock, cost and accounts are handled by the database
 * function; see supabase/migrations/20261111100000_phase61_01_site_material_dc_v2.sql.
 */
export async function createSiteMaterialDocAction(input: {
  service_job_id?: string;
  job_id?: string;
  kind: "issue" | "return";
  warehouse_id?: string;
  doc_date: string;
  vehicle_no: string;
  driver_name: string;
  reference: string;
  dc_description: string;
  lines: SiteMaterialLineInput[];
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  const allowed = await hasPermission(user, input.job_id ? "job.material.manage" : "service_material.manage");
  if (!allowed) return { error: "You don't have permission to perform this action." };
  if (!input.service_job_id === !input.job_id) return { error: "Choose a Service Job or a Job." };
  if (!input.lines.length) return { error: "Add at least one item." };
  for (const l of input.lines) {
    if (!Number.isFinite(l.qty) || l.qty <= 0) return { error: "Quantity must be more than zero." };
    if (l.is_stock && !l.item_id) return { error: "Choose a stock item on every stock line." };
    if (!l.is_stock && !(l.custom_name ?? "").trim()) return { error: "Write the name of every custom item." };
    if (!l.is_stock && l.unit_cost !== undefined && (!Number.isFinite(l.unit_cost) || l.unit_cost < 0)) return { error: "The cost of a custom item cannot be negative." };
  }
  const needsWarehouse = input.lines.some((l) => l.is_stock);
  if (needsWarehouse && !input.job_id && !input.warehouse_id) return { error: "Choose a warehouse." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_site_material_doc", {
    p_service_job_id: (input.service_job_id ?? null) as string,
    p_job_id: (input.job_id ?? null) as string,
    p_kind: input.kind,
    p_doc_date: input.doc_date as string,
    p_warehouse_id: (input.warehouse_id ?? null) as string,
    p_vehicle_no: input.vehicle_no as string,
    p_driver_name: input.driver_name as string,
    p_reference: input.reference as string,
    p_dc_description: input.dc_description as string,
    p_lines: input.lines.map((l) => ({
      is_stock: l.is_stock,
      item_id: l.item_id ?? null,
      custom_name: l.custom_name?.trim() ?? null,
      qty: l.qty,
      unit: l.unit?.trim() || null,
      unit_cost: l.unit_cost ?? 0,
      description: l.description?.trim() || null,
    })) as unknown as Json,
  });
  if (error) return { error: error.message };
  revalidatePath(input.job_id ? `/jobs/${input.job_id}` : `/service-jobs/${input.service_job_id}`);
  return { error: null, id: data as string, success: true };
}

export async function cancelSiteMaterialDocAction(docId: string, jobPath: string, reason: string): Promise<ActionResult> {
  if (!isOwner(await getCurrentUser())) return { error: "Only the Owner can cancel a material document." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_service_material_doc", { p_doc_id: docId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath(jobPath);
  return { error: null, success: true };
}
