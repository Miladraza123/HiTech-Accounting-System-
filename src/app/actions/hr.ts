"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser, hasRole, isOwner } from "@/lib/auth";
import type { HrRules } from "@/lib/hrRules";
import type { Json } from "@/lib/supabase/database.types";

// HR / Attendance masters. Every write goes through a SECURITY DEFINER
// fn_hr_* function, which carries the real role check (Owner or "hr");
// the check here only gives a clear message before the round trip.

export type ActionResult = { error: string | null; id?: string };

const NO_PERMISSION: ActionResult = { error: "Only the Owner or HR can do this." };

async function canManage(): Promise<boolean> {
  const user = await getCurrentUser();
  return isOwner(user) || hasRole(user, "hr");
}

function revalidateHr(paths: string[] = []) {
  revalidatePath("/hr/employees");
  revalidatePath("/hr/policies");
  for (const p of paths) revalidatePath(p);
}

export type TermsInput = {
  policy_group_id: string;
  employee_type: "permanent" | "daily_wager";
  monthly_salary: number | null;
  wage_basis: "per_day" | "per_minute" | null;
  wage_rate: number | null;
  rule_overrides: Partial<HrRules>;
};

export type EmployeeDetailsInput = {
  code: string;
  full_name: string;
  father_name: string;
  cnic: string;
  phone: string;
  address: string;
  designation: string;
  department: string;
  join_date: string;
  notes: string;
};

// ---------------------------------------------------------------------------
// Policy groups
// ---------------------------------------------------------------------------
export async function createPolicyGroupAction(input: {
  name: string;
  description: string;
  rules: HrRules;
  effective_from: string;
}): Promise<ActionResult> {
  if (!(await canManage())) return NO_PERMISSION;
  if (!input.name.trim()) return { error: "Group name is required." };
  if (!input.effective_from) return { error: "Effective from date is required." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_hr_create_policy_group", {
    p_name: input.name.trim(),
    p_description: input.description.trim() as string,
    p_rules: input.rules as unknown as Json,
    p_effective_from: input.effective_from,
  });
  if (error) return { error: error.message };
  revalidateHr();
  return { error: null, id: data as string };
}

export async function updatePolicyGroupAction(input: {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
}): Promise<ActionResult> {
  if (!(await canManage())) return NO_PERMISSION;
  if (!input.name.trim()) return { error: "Group name is required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_hr_update_policy_group", {
    p_group_id: input.id,
    p_name: input.name.trim(),
    p_description: input.description.trim() as string,
    p_is_active: input.is_active,
  });
  if (error) return { error: error.message };
  revalidateHr([`/hr/policies/${input.id}`]);
  return { error: null, id: input.id };
}

export async function setPolicyVersionAction(input: {
  group_id: string;
  effective_from: string;
  rules: HrRules;
  reason: string;
}): Promise<ActionResult> {
  if (!(await canManage())) return NO_PERMISSION;
  if (!input.effective_from) return { error: "Effective from date is required." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_hr_set_policy_version", {
    p_group_id: input.group_id,
    p_effective_from: input.effective_from,
    p_rules: input.rules as unknown as Json,
    p_reason: input.reason.trim() as string,
  });
  if (error) return { error: error.message };
  revalidateHr([`/hr/policies/${input.group_id}`]);
  return { error: null, id: data as string };
}

export async function deletePolicyVersionAction(groupId: string, versionId: string): Promise<ActionResult> {
  if (!(await canManage())) return NO_PERMISSION;
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_hr_delete_policy_version", { p_version_id: versionId });
  if (error) return { error: error.message };
  revalidateHr([`/hr/policies/${groupId}`]);
  return { error: null };
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------
export async function createEmployeeAction(input: EmployeeDetailsInput & TermsInput): Promise<ActionResult> {
  if (!(await canManage())) return NO_PERMISSION;
  if (!input.full_name.trim()) return { error: "Employee name is required." };
  if (!input.join_date) return { error: "Joining date is required." };
  if (!input.policy_group_id) return { error: "Pick a policy group." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_hr_create_employee", {
    p: { ...input, effective_from: input.join_date } as unknown as Json,
  });
  if (error) return { error: error.message };
  revalidateHr();
  return { error: null, id: data as string };
}

export async function updateEmployeeAction(id: string, input: EmployeeDetailsInput): Promise<ActionResult> {
  if (!(await canManage())) return NO_PERMISSION;
  if (!input.full_name.trim()) return { error: "Employee name is required." };
  if (!input.code.trim()) return { error: "Employee code is required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_hr_update_employee", {
    p_employee_id: id,
    p: input as unknown as Json,
  });
  if (error) return { error: error.message };
  revalidateHr([`/hr/employees/${id}`]);
  return { error: null, id };
}

export async function setEmployeeTermsAction(
  employeeId: string,
  input: TermsInput & { effective_from: string; reason: string }
): Promise<ActionResult> {
  if (!(await canManage())) return NO_PERMISSION;
  if (!input.effective_from) return { error: "Effective from date is required." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_hr_set_employee_terms", {
    p_employee_id: employeeId,
    p_effective_from: input.effective_from,
    p_policy_group_id: input.policy_group_id,
    p_employee_type: input.employee_type,
    p_monthly_salary: input.monthly_salary as number,
    p_wage_basis: input.wage_basis as string,
    p_wage_rate: input.wage_rate as number,
    p_rule_overrides: input.rule_overrides as unknown as Json,
    p_reason: input.reason.trim() as string,
  });
  if (error) return { error: error.message };
  revalidateHr([`/hr/employees/${employeeId}`]);
  return { error: null, id: data as string };
}

export async function deleteEmployeeTermsAction(employeeId: string, termsId: string): Promise<ActionResult> {
  if (!(await canManage())) return NO_PERMISSION;
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_hr_delete_employee_terms", { p_terms_id: termsId });
  if (error) return { error: error.message };
  revalidateHr([`/hr/employees/${employeeId}`]);
  return { error: null };
}

export async function setEmployeeStatusAction(
  employeeId: string,
  status: "Active" | "Left",
  leaveDate: string | null
): Promise<ActionResult> {
  if (!(await canManage())) return NO_PERMISSION;
  if (status === "Left" && !leaveDate) return { error: "Leaving date is required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_hr_set_employee_status", {
    p_employee_id: employeeId,
    p_status: status,
    p_leave_date: leaveDate as string,
  });
  if (error) return { error: error.message };
  revalidateHr([`/hr/employees/${employeeId}`]);
  return { error: null };
}

// ---------------------------------------------------------------------------
// Settings (Owner only)
// ---------------------------------------------------------------------------
export async function updateHrSettingsAction(salaryJournalEnabled: boolean): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!isOwner(user)) return { error: "Only the Owner can change HR settings." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_hr_update_settings", { p_salary_journal_enabled: salaryJournalEnabled });
  if (error) return { error: error.message };
  revalidatePath("/hr/settings");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Daily attendance
// ---------------------------------------------------------------------------
export type AttendanceRowInput = {
  employee_id: string;
  mark: "present" | "absent" | "leave" | null;
  check_in: string | null;
  check_out: string | null;
  extra_pairs: { in: string; out: string }[];
  leave_type_id: string | null;
  leave_fraction: number | null;
  note: string | null;
};

export async function saveAttendanceAction(date: string, rows: AttendanceRowInput[]): Promise<ActionResult & { saved?: number }> {
  if (!(await canManage())) return NO_PERMISSION;
  if (!date) return { error: "Date is required." };
  if (!rows.length) return { error: null, saved: 0 };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_hr_save_attendance", { p_date: date, p_rows: rows as unknown as Json });
  if (error) return { error: error.message };
  revalidatePath("/hr/attendance");
  return { error: null, saved: data as number };
}

// ---------------------------------------------------------------------------
// Holidays and leave types
// ---------------------------------------------------------------------------
export async function addHolidayAction(date: string, name: string): Promise<ActionResult> {
  if (!(await canManage())) return NO_PERMISSION;
  if (!date || !name.trim()) return { error: "Date and name are required." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_hr_add_holiday", { p_date: date, p_name: name.trim() });
  if (error) return { error: error.message };
  revalidatePath("/hr/holidays");
  return { error: null, id: data as string };
}

export async function deleteHolidayAction(id: string): Promise<ActionResult> {
  if (!(await canManage())) return NO_PERMISSION;
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_hr_delete_holiday", { p_holiday_id: id });
  if (error) return { error: error.message };
  revalidatePath("/hr/holidays");
  return { error: null };
}

export async function saveLeaveTypeAction(input: { id: string | null; name: string; is_paid: boolean; is_active: boolean }): Promise<ActionResult> {
  if (!(await canManage())) return NO_PERMISSION;
  if (!input.name.trim()) return { error: "Name is required." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_hr_save_leave_type", {
    p_id: input.id as string,
    p_name: input.name.trim(),
    p_is_paid: input.is_paid,
    p_is_active: input.is_active,
  });
  if (error) return { error: error.message };
  revalidatePath("/hr/holidays");
  return { error: null, id: data as string };
}
