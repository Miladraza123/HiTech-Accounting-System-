"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ActionResult = { error: string | null; id?: string };

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
}): Promise<ActionResult> {
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
  });
  if (error) return { error: error.message };
  revalidatePath("/payments");
  revalidatePath("/invoices");
  revalidatePath("/supplier-bills");
  return { error: null, id: data as string };
}

export async function allocatePaymentAction(paymentId: string, allocations: PaymentAllocationInput[]): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_allocate_payment", { p_payment_id: paymentId, p_allocations: allocations });
  revalidatePath(`/payments/${paymentId}`);
  revalidatePath("/invoices");
  revalidatePath("/supplier-bills");
  return { error: error?.message ?? null };
}

export async function cancelPaymentAction(paymentId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_payment", { p_payment_id: paymentId, p_reason: reason });
  revalidatePath(`/payments/${paymentId}`);
  revalidatePath("/payments");
  revalidatePath("/invoices");
  revalidatePath("/supplier-bills");
  return { error: error?.message ?? null };
}
