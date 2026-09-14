"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { diffFields, smartMergeUpdate, type SmartMergeConflict } from "@/lib/smartMerge";

export type ActionResult = { error: string | null; id?: string; success?: boolean; conflicts?: SmartMergeConflict[] };

export async function createVehicleAction(input: {
  vehicle_no: string;
  registration_no: string | null;
  vehicle_type: string | null;
  make_model: string | null;
  assigned_user_id: string | null;
  assignment_date: string | null;
  opening_meter_reading: number;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicles")
    .insert({
      vehicle_no: input.vehicle_no,
      registration_no: input.registration_no,
      vehicle_type: input.vehicle_type,
      make_model: input.make_model,
      assigned_user_id: input.assigned_user_id,
      assignment_date: input.assignment_date,
      opening_meter_reading: input.opening_meter_reading,
      current_meter_reading: input.opening_meter_reading,
      status: input.assigned_user_id ? "Active" : "Unassigned",
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/setup/vehicles");
  return { error: null, id: data.id };
}

// Phase 8 (Master Offline-First Roadmap): now routes through the same
// generic Smart Merge engine as Company/Party/Warehouse instead of a
// direct `.update()` — a genuine field-level 3-way merge (someone else's
// concurrent change to a different field is never lost) instead of a
// blind overwrite, and offline-safe via the same queue path.
export async function updateVehicleAction(
  id: string,
  base: { assigned_user_id: string | null; assignment_date: string | null; status: string },
  next: { assigned_user_id: string | null; assignment_date: string | null; status: string }
): Promise<ActionResult> {
  const supabase = await createClient();
  const changes = diffFields(base, next);
  const { result, error } = await smartMergeUpdate(supabase, "vehicles", id, base, changes);
  if (error) return { error: error.message };
  if (result && result.conflicts.length > 0) {
    return { error: null, conflicts: result.conflicts };
  }

  revalidatePath("/setup/vehicles");
  revalidatePath(`/setup/vehicles/${id}`);
  return { error: null, success: true };
}
