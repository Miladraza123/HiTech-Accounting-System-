"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ActionResult = { error: string | null; id?: string };

export type TaskPriority = "Low" | "Medium" | "High";

export async function createTaskAction(
  input: {
    title: string;
    description: string | null;
    assigned_to: string;
    due_date: string | null;
    priority: TaskPriority;
    related_table?: string | null;
    related_id?: string | null;
  },
  revalidateTo: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_task", {
    p_title: input.title,
    p_assigned_to: input.assigned_to,
    p_description: input.description as string,
    p_due_date: input.due_date as string,
    p_priority: input.priority,
    p_related_table: (input.related_table ?? null) as string,
    p_related_id: (input.related_id ?? null) as string,
  });
  if (error) return { error: error.message };
  revalidatePath(revalidateTo);
  revalidatePath("/tasks");
  return { error: null, id: data as string };
}

export async function updateTaskAction(
  taskId: string,
  input: { title: string; description: string | null; assigned_to: string; due_date: string | null; priority: TaskPriority },
  revalidateTo: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_update_task", {
    p_task_id: taskId,
    p_title: input.title,
    p_assigned_to: input.assigned_to,
    p_description: input.description as string,
    p_due_date: input.due_date as string,
    p_priority: input.priority,
  });
  if (error) return { error: error.message };
  revalidatePath(revalidateTo);
  revalidatePath("/tasks");
  return { error: null };
}

export async function completeTaskAction(taskId: string, revalidateTo: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_complete_task", { p_task_id: taskId });
  if (error) return { error: error.message };
  revalidatePath(revalidateTo);
  revalidatePath("/tasks");
  return { error: null };
}

export async function reopenTaskAction(taskId: string, revalidateTo: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_reopen_task", { p_task_id: taskId });
  if (error) return { error: error.message };
  revalidatePath(revalidateTo);
  revalidatePath("/tasks");
  return { error: null };
}

export async function cancelTaskAction(taskId: string, reason: string | null, revalidateTo: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_task", { p_task_id: taskId, p_reason: reason as string });
  if (error) return { error: error.message };
  revalidatePath(revalidateTo);
  revalidatePath("/tasks");
  return { error: null };
}
