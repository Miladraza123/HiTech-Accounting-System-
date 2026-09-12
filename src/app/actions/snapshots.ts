"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ActionResult = { error: string | null };

export async function generateDailySnapshotAction(date: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_generate_daily_snapshot", { p_date: date });
  if (error) return { error: error.message };
  revalidatePath("/reports/daily-snapshot");
  return { error: null };
}
