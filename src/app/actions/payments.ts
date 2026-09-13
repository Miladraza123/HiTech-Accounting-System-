"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export type ActionResult = { error: string | null; id?: string };

const NO_PERMISSION: ActionResult = { error: "You don't have permission to perform this action." };

export type PaymentAllocationInput =
  | { invoice_id: string; amount: number }
  | { supplier_bill_id: string; amount: number };

export async function createPaymentAction(input: {
  party_id: string;
  direction: "receipt" | "payment";
  payment_date: string;
  method: string | null;
  reference_no: string | null;
  amount: number;
  notes: string | null;
  allocations: PaymentAllocationInput[];
  bank_account_id?: string | null;
  petty_cash_fund_id?: string | null;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "payment.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_payment", {
    p_party_id: input.party_id,
    p_direction: input.direction,
    p_payment_date: input.payment_date,
    p_method: input.method as string,
    p_reference_no: input.reference_no as string,
    p_amount: input.amount,
    p_notes: input.notes as string,
    p_allocations: input.allocations,
    p_bank_account_id: (input.bank_account_id ?? null) as string,
    p_petty_cash_fund_id: (input.petty_cash_fund_id ?? null) as string,
  });
  if (error) return { error: error.message };
  revalidatePath("/payments");
  revalidatePath("/invoices");
  revalidatePath("/supplier-bills");
  return { error: null, id: data as string };
}

export async function allocatePaymentAction(paymentId: string, allocations: PaymentAllocationInput[]): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "payment.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_allocate_payment", { p_payment_id: paymentId, p_allocations: allocations });
  revalidatePath(`/payments/${paymentId}`);
  revalidatePath("/invoices");
  revalidatePath("/supplier-bills");
  return { error: error?.message ?? null };
}

export async function cancelPaymentAction(paymentId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "payment.manage"))) return NO_PERMISSION;

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_payment", { p_payment_id: paymentId, p_reason: reason });
  revalidatePath(`/payments/${paymentId}`);
  revalidatePath("/payments");
  revalidatePath("/invoices");
  revalidatePath("/supplier-bills");
  return { error: error?.message ?? null };
}

// ---------- Multiple payments in one go ----------
// Each row lands the same way an unallocated/"on account" single payment
// already can — no bill-wise allocation inside the batch grid; allocate
// afterward from that payment's own detail page (AllocatePaymentPanel),
// same as a single payment left unallocated today.
//
// fn_create_payments_batch calls fn_create_payment once per row inside
// one Postgres function invocation, so the whole batch is atomic: if any
// row fails validation, none of the rows are posted (see the migration
// for details) — the error names which row and why, so the batch can be
// fixed and resubmitted rather than the client trying to sort out which
// of several partially-applied rows succeeded.
export type BatchPaymentInput = {
  party_id: string;
  direction: "receipt" | "payment";
  payment_date: string;
  method: string | null;
  reference_no: string | null;
  amount: number;
  notes: string | null;
  bank_account_id?: string | null;
  petty_cash_fund_id?: string | null;
};

export type BatchPaymentResult = { id: string; payment_no: string };

export async function createPaymentsBatchAction(
  payments: BatchPaymentInput[]
): Promise<ActionResult & { payments?: BatchPaymentResult[] }> {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "payment.manage"))) return NO_PERMISSION;
  if (!payments.length) return { error: "Add at least one payment row." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_payments_batch", {
    p_payments: payments.map((p) => ({
      party_id: p.party_id,
      direction: p.direction,
      payment_date: p.payment_date,
      method: p.method,
      reference_no: p.reference_no,
      amount: p.amount,
      notes: p.notes,
      allocations: [],
      bank_account_id: p.bank_account_id ?? null,
      petty_cash_fund_id: p.petty_cash_fund_id ?? null,
    })),
  });
  if (error) return { error: error.message };

  revalidatePath("/payments");
  revalidatePath("/invoices");
  revalidatePath("/supplier-bills");
  return { error: null, payments: (data as unknown as BatchPaymentResult[]) ?? [] };
}
