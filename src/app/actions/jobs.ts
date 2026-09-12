"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export type ActionResult = { error: string | null; id?: string };

const NO_PERMISSION: ActionResult = { error: "You don't have permission to perform this action." };

export type MaterialLineInput = { item_id: string; required_qty: number; unit?: string };
export type TemplateLineInput = { item_id: string; qty_per_unit: number; unit?: string };

export async function createProductTemplateAction(input: {
  template_code: string;
  name: string;
  description: string | null;
  output_item_id: string | null;
  output_unit: string | null;
  lines: TemplateLineInput[];
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "product_template.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_product_template", {
    p_template_code: input.template_code,
    p_name: input.name,
    p_description: input.description as string,
    p_output_item_id: input.output_item_id as string,
    p_output_unit: input.output_unit as string,
    p_lines: input.lines,
  });
  if (error) return { error: error.message };
  revalidatePath("/product-templates");
  return { error: null, id: data as string };
}

export async function createJobAction(input: {
  sales_order_line_id: string;
  warehouse_id: string;
  product_template_id: string | null;
  description: string;
  job_qty: number;
  responsible_user_id: string | null;
  start_date: string | null;
  required_delivery_date: string | null;
  material_lines: MaterialLineInput[];
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "job.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_job", {
    p_sales_order_line_id: input.sales_order_line_id,
    p_warehouse_id: input.warehouse_id,
    p_product_template_id: input.product_template_id as string,
    p_description: input.description,
    p_job_qty: input.job_qty,
    p_responsible_user_id: input.responsible_user_id as string,
    p_start_date: input.start_date as string,
    p_required_delivery_date: input.required_delivery_date as string,
    p_material_lines: input.material_lines,
  });
  if (error) return { error: error.message };
  revalidatePath("/jobs");
  return { error: null, id: data as string };
}

export async function reserveJobMaterialAction(
  jobId: string,
  itemId: string,
  warehouseId: string,
  qty: number
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "job.material.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_reserve_job_material", {
    p_job_id: jobId,
    p_item_id: itemId,
    p_warehouse_id: warehouseId,
    p_qty: qty,
  });
  revalidatePath(`/jobs/${jobId}`);
  return { error: error?.message ?? null };
}

export async function releaseJobMaterialAction(reservationId: string, jobId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "job.material.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_release_job_material", { p_reservation_id: reservationId });
  revalidatePath(`/jobs/${jobId}`);
  return { error: error?.message ?? null };
}

export async function issueJobMaterialAction(jobId: string, itemId: string, qty: number): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "job.material.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_issue_job_material", {
    p_job_id: jobId,
    p_item_id: itemId,
    p_qty: qty,
  });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/inventory");
  return { error: error?.message ?? null };
}

export async function returnJobMaterialAction(jobId: string, itemId: string, qty: number): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "job.material.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_return_job_material", {
    p_job_id: jobId,
    p_item_id: itemId,
    p_qty: qty,
  });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/inventory");
  return { error: error?.message ?? null };
}

export async function updateJobProgressAction(jobId: string, progressPct: number, note: string | null): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "job.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_update_job_progress", {
    p_job_id: jobId,
    p_progress_pct: progressPct,
    p_note: note as string,
  });
  revalidatePath(`/jobs/${jobId}`);
  return { error: error?.message ?? null };
}

export async function markJobReadyForDispatchAction(jobId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "job.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_mark_job_ready_for_dispatch", { p_job_id: jobId });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return { error: error?.message ?? null };
}

export async function cancelJobAction(jobId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "job.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_job", { p_job_id: jobId, p_reason: reason });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return { error: error?.message ?? null };
}
