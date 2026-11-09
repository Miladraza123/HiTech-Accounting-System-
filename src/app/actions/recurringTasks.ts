"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

export type ActionResult = { error: string | null; id?: string };

export type RecurringTaskInput = {
  id?: string;
  title: string;
  description: string;
  /** Owner only: who the task is for. Left out, it is for the signed-in user. */
  assigned_to?: string;
  priority: "Low" | "Medium" | "High";
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  weekdays: number[];
  month_day: number | null;
  month: number | null;
  /** "HH:MM" or empty for no time. */
  due_time: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
};

function refresh() {
  revalidatePath("/tasks/recurring");
  revalidatePath("/tasks");
  revalidatePath("/reports");
}

/** Create or change a recurring task. The database checks every rule; see fn_save_recurring_task. */
export async function saveRecurringTaskAction(input: RecurringTaskInput): Promise<ActionResult> {
  if (!(await getCurrentUser())) return { error: "Sign in required." };
  if (!input.title.trim()) return { error: "Enter a title." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_save_recurring_task", {
    p_id: (input.id ?? null) as string,
    p_title: input.title,
    p_description: input.description as string,
    p_assigned_to: (input.assigned_to ?? null) as string,
    p_priority: input.priority,
    p_frequency: input.frequency,
    p_weekdays: input.weekdays,
    p_month_day: input.month_day as number,
    p_month: input.month as number,
    p_due_time: (input.due_time || null) as string,
    p_start_date: input.start_date as string,
    p_end_date: input.end_date as string,
    p_is_active: input.is_active,
  });
  if (error) return { error: error.message };
  refresh();
  return { error: null, id: data as string };
}

export async function setRecurringTaskActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_set_recurring_task_active", { p_id: id, p_active: active });
  if (error) return { error: error.message };
  refresh();
  return { error: null };
}

export async function deleteRecurringTaskAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_delete_recurring_task", { p_id: id });
  if (error) return { error: error.message };
  refresh();
  return { error: null };
}
