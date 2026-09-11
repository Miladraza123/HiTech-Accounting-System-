"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ActionResult = { error: string | null; id?: string };

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

export async function updateVehicleAction(
  id: string,
  input: {
    assigned_user_id: string | null;
    assignment_date: string | null;
    status: "Active" | "UnderMaintenance" | "Retired" | "Unassigned";
  }
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicles")
    .update({
      assigned_user_id: input.assigned_user_id,
      assignment_date: input.assignment_date,
      status: input.status,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/setup/vehicles");
  revalidatePath(`/setup/vehicles/${id}`);
  return { error: null };
}
