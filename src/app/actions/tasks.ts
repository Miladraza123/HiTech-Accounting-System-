"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/webPush";
import { revalidatePath } from "next/cache";

export type ActionResult = { error: string | null; id?: string };

export type TaskPriority = "Low" | "Medium" | "High";

// Mirrors Dispatch Go-Ahead's exact push piggyback (src/app/actions/dispatch.ts):
// each Task RPC that notifies inserts exactly one notifications row, so
// fetching it back here (admin client — the row belongs to the RECIPIENT,
// hidden from the actor's own client by notifications' RLS) keeps the push
// payload and the in-app bell saying the same thing. Best-effort: push
// failing (or no service-role key configured) never fails the action.
async function pushLatestTaskNotification(taskId: string, type: string) {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("notifications")
      .select("recipient_user_id, title, description, href")
      .eq("related_table", "tasks")
      .eq("related_id", taskId)
      .eq("type", type)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return;
    await sendPushToUser(data.recipient_user_id, { title: data.title, body: data.description ?? "", href: data.href ?? "/" });
  } catch {
    // The in-app notification row already landed; push is an enhancement.
  }
}

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
  const taskId = data as string;
  await pushLatestTaskNotification(taskId, "task_assigned");
  revalidatePath(revalidateTo);
  revalidatePath("/tasks");
  return { error: null, id: taskId };
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
  await pushLatestTaskNotification(taskId, "task_assigned");
  revalidatePath(revalidateTo);
  revalidatePath("/tasks");
  return { error: null };
}

export async function acceptTaskAction(taskId: string, revalidateTo: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_accept_task", { p_task_id: taskId });
  if (error) return { error: error.message };
  await pushLatestTaskNotification(taskId, "task_accepted");
  revalidatePath(revalidateTo);
  revalidatePath("/tasks");
  return { error: null };
}

export async function completeTaskAction(taskId: string, revalidateTo: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_complete_task", { p_task_id: taskId });
  if (error) return { error: error.message };
  await pushLatestTaskNotification(taskId, "task_completed");
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
