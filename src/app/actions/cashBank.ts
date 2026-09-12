"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export type ActionResult = { error: string | null; id?: string };

const NO_PERMISSION: ActionResult = { error: "Aap ke paas yeh action karne ki ijazat nahi hai." };

// ---- Bank Accounts ----

export async function createBankAccountAction(input: {
  account_name: string;
  bank_name: string | null;
  account_number: string | null;
  branch: string | null;
  opening_balance: number;
  opening_balance_date: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_bank_account", {
    p_account_name: input.account_name,
    p_bank_name: input.bank_name as string,
    p_account_number: input.account_number as string,
    p_branch: input.branch as string,
    p_opening_balance: input.opening_balance,
    p_opening_balance_date: input.opening_balance_date,
  });
  if (error) return { error: error.message };
  revalidatePath("/setup/bank-accounts");
  revalidatePath("/cash-bank");
  return { error: null, id: data as string };
}

export async function toggleBankAccountActiveAction(id: string, isActive: boolean) {
  const supabase = await createClient();
  await supabase.from("bank_accounts").update({ is_active: isActive }).eq("id", id);
  revalidatePath("/setup/bank-accounts");
}

// ---- Petty Cash Funds ----

export async function createPettyCashFundAction(input: {
  fund_name: string;
  custodian_user_id: string | null;
  opening_balance: number;
  opening_balance_date: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_petty_cash_fund", {
    p_fund_name: input.fund_name,
    p_custodian_user_id: input.custodian_user_id as string,
    p_opening_balance: input.opening_balance,
    p_opening_balance_date: input.opening_balance_date,
  });
  if (error) return { error: error.message };
  revalidatePath("/setup/petty-cash-funds");
  revalidatePath("/cash-bank");
  return { error: null, id: data as string };
}

export async function togglePettyCashFundActiveAction(id: string, isActive: boolean) {
  const supabase = await createClient();
  await supabase.from("petty_cash_funds").update({ is_active: isActive }).eq("id", id);
  revalidatePath("/setup/petty-cash-funds");
}

// ---- Expense Heads ----

export async function createExpenseHeadAction(name: string, code: string | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_expense_head", {
    p_name: name,
    p_code: code as string,
  });
  if (error) return { error: error.message };
  revalidatePath("/setup/expense-heads");
  return { error: null, id: data as string };
}

export async function toggleExpenseHeadActiveAction(id: string, isActive: boolean) {
  const supabase = await createClient();
  await supabase.from("expense_heads").update({ is_active: isActive }).eq("id", id);
  revalidatePath("/setup/expense-heads");
}

// ---- Expenses ----

export async function createExpenseAction(input: {
  expense_date: string;
  expense_head_id: string;
  amount: number;
  payment_source: "cash" | "bank" | "petty_cash";
  bank_account_id: string | null;
  petty_cash_fund_id: string | null;
  job_id: string | null;
  responsible_user_id: string | null;
  department: string | null;
  description: string | null;
  vehicle_id?: string | null;
  odometer_reading?: number | null;
  fuel_litres?: number | null;
  fuel_rate?: number | null;
  settlement_status?: "Settled" | "Pending";
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "expense.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_expense", {
    p_expense_date: input.expense_date,
    p_expense_head_id: input.expense_head_id,
    p_amount: input.amount,
    p_payment_source: input.payment_source,
    p_bank_account_id: input.bank_account_id as string,
    p_petty_cash_fund_id: input.petty_cash_fund_id as string,
    p_job_id: input.job_id as string,
    p_responsible_user_id: input.responsible_user_id as string,
    p_department: input.department as string,
    p_description: input.description as string,
    p_vehicle_id: (input.vehicle_id ?? null) as string,
    p_odometer_reading: (input.odometer_reading ?? null) as number,
    p_fuel_litres: (input.fuel_litres ?? null) as number,
    p_fuel_rate: (input.fuel_rate ?? null) as number,
    p_settlement_status: input.settlement_status ?? "Settled",
  });
  if (error) return { error: error.message };
  revalidatePath("/expenses");
  revalidatePath("/cash-bank");
  return { error: null, id: data as string };
}

export async function cancelExpenseAction(expenseId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "expense.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_expense", { p_expense_id: expenseId, p_reason: reason });
  revalidatePath(`/expenses/${expenseId}`);
  revalidatePath("/expenses");
  revalidatePath("/cash-bank");
  return { error: error?.message ?? null };
}

// ---- Contra / Fund Transfers ----

export type ContraSourceType = "cash" | "bank" | "petty_cash";

export async function createContraEntryAction(input: {
  transfer_date: string;
  from_type: ContraSourceType;
  from_bank_account_id: string | null;
  from_petty_cash_fund_id: string | null;
  to_type: ContraSourceType;
  to_bank_account_id: string | null;
  to_petty_cash_fund_id: string | null;
  amount: number;
  notes: string | null;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "fund_transfer.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_contra_entry", {
    p_transfer_date: input.transfer_date,
    p_from_type: input.from_type,
    p_from_bank_account_id: input.from_bank_account_id as string,
    p_from_petty_cash_fund_id: input.from_petty_cash_fund_id as string,
    p_to_type: input.to_type,
    p_to_bank_account_id: input.to_bank_account_id as string,
    p_to_petty_cash_fund_id: input.to_petty_cash_fund_id as string,
    p_amount: input.amount,
    p_notes: input.notes as string,
  });
  if (error) return { error: error.message };
  revalidatePath("/transfers");
  revalidatePath("/cash-bank");
  return { error: null, id: data as string };
}

export async function cancelContraEntryAction(transferId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "fund_transfer.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_contra_entry", { p_transfer_id: transferId, p_reason: reason });
  revalidatePath(`/transfers/${transferId}`);
  revalidatePath("/transfers");
  revalidatePath("/cash-bank");
  return { error: error?.message ?? null };
}

// ---- Manual Journal Voucher ----

export type JournalVoucherLineInput = {
  account_code: string;
  party_id?: string;
  bank_account_id?: string;
  petty_cash_fund_id?: string;
  debit: number;
  credit: number;
  memo?: string;
};

export async function createJournalVoucherAction(input: {
  entry_date: string;
  narration: string;
  lines: JournalVoucherLineInput[];
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "journal_voucher.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_post_journal_entry", {
    p_entry_date: input.entry_date,
    p_narration: input.narration,
    p_source_table: "manual",
    p_source_id: null as unknown as string,
    p_lines: input.lines,
  });
  if (error) return { error: error.message };
  revalidatePath("/journal-vouchers");
  revalidatePath("/reports/trial-balance");
  return { error: null, id: data as string };
}
