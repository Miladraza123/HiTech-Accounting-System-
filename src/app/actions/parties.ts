"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { diffFields, smartMergeUpdate, type SmartMergeConflict } from "@/lib/smartMerge";

export type ActionResult = { error: string | null; success?: boolean; conflicts?: SmartMergeConflict[]; warning?: string };

// Turns the two Postgres errors a normal user can actually trigger from the
// party forms into plain language; anything else is passed through as-is.
function friendlyPartyError(error: { code?: string; message: string }): string {
  if (error.code === "23505" && error.message.includes("idx_parties_legal_name_unique")) {
    return "A client/supplier with this name already exists.";
  }
  if (error.code === "22003") return "Amount is too large.";
  return error.message;
}

// Blank means 0; anything else must be a finite, non-negative number.
function parseNonNegative(raw: FormDataEntryValue | null, label: string, integer = false): { value: number; error: string | null } {
  const text = String(raw ?? "").trim();
  if (!text) return { value: 0, error: null };
  const value = Number(text);
  if (!Number.isFinite(value)) return { value: 0, error: `${label} must be a number.` };
  if (value < 0) return { value: 0, error: `${label} cannot be negative.` };
  if (integer && !Number.isInteger(value)) return { value: 0, error: `${label} must be a whole number of days.` };
  return { value, error: null };
}

export async function createPartyAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const legal_name = String(formData.get("legal_name") ?? "").trim();
  const party_type = String(formData.get("party_type") ?? "client");
  if (!legal_name) return { error: "Name is required." };

  const creditLimit = parseNonNegative(formData.get("credit_limit"), "Credit limit");
  if (creditLimit.error) return { error: creditLimit.error };
  const creditDays = parseNonNegative(formData.get("credit_days"), "Credit days", true);
  if (creditDays.error) return { error: creditDays.error };

  const { data: party, error } = await supabase
    .from("parties")
    .insert({
      legal_name,
      party_type,
      ntn: String(formData.get("ntn") ?? "").trim() || null,
      strn: String(formData.get("strn") ?? "").trim() || null,
      cnic: String(formData.get("cnic") ?? "").trim() || null,
      billing_address: String(formData.get("billing_address") ?? "").trim() || null,
      province: String(formData.get("province") ?? "").trim() || null,
      credit_limit: creditLimit.value,
      credit_days: creditDays.value,
      created_by: user?.id,
    })
    .select("id")
    .single();

  if (error) return { error: friendlyPartyError(error) };

  // Optional opening balance at creation, posted via the same
  // fn_post_journal_entry RPC and account pair (1200/1900 receivable,
  // 1900/2100 payable) the Import Wizard's opening_receivables/
  // opening_payables already use. The party is already created at this
  // point, so a failure here (e.g. the creator isn't Owner/Accounts, which
  // the RPC itself enforces) is reported as a warning rather than undoing
  // the party — it can still be set correctly afterwards from the party's
  // own page.
  const openingReceivable = Number(formData.get("opening_receivable") ?? 0);
  const openingPayable = Number(formData.get("opening_payable") ?? 0);
  const warnings: string[] = [];

  if (openingReceivable > 0) {
    const { error: jeError } = await supabase.rpc("fn_post_journal_entry", {
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_narration: `Opening balance — ${legal_name}`,
      p_source_table: "parties",
      p_source_id: party.id,
      p_lines: [
        { account_code: "1200", party_id: party.id, debit: openingReceivable, credit: 0, memo: "Opening balance" },
        { account_code: "1900", party_id: null, debit: 0, credit: openingReceivable, memo: "Opening balance" },
      ],
    });
    if (jeError) warnings.push(`Opening Balance (Receivable) could not be posted: ${jeError.message}`);
  }
  if (openingPayable > 0) {
    const { error: jeError } = await supabase.rpc("fn_post_journal_entry", {
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_narration: `Opening balance — ${legal_name}`,
      p_source_table: "parties",
      p_source_id: party.id,
      p_lines: [
        { account_code: "1900", party_id: null, debit: openingPayable, credit: 0, memo: "Opening balance" },
        { account_code: "2100", party_id: party.id, debit: 0, credit: openingPayable, memo: "Opening balance" },
      ],
    });
    if (jeError) warnings.push(`Opening Balance (Payable) could not be posted: ${jeError.message}`);
  }

  revalidatePath("/clients");
  return { error: null, success: true, warning: warnings.length ? warnings.join(" ") : undefined };
}

// There is no separate "opening_balance" column — the balance is purely the
// sum of journal_lines for this party's receivable/payable account (exactly
// what the Party Ledger report already shows), so correcting it means
// posting a new adjusting entry for the difference, never rewriting the
// original one. fn_adjust_party_balance computes the current balance itself
// so this action never has to pass a delta the party may have moved past.
export async function adjustPartyBalanceAction(
  partyId: string,
  direction: "receivable" | "payable",
  newBalance: number,
  narration?: string
): Promise<ActionResult> {
  if (newBalance < 0) return { error: "Balance cannot be negative." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_adjust_party_balance", {
    p_party_id: partyId,
    p_direction: direction,
    p_new_balance: newBalance,
    p_narration: narration || "Opening balance adjustment",
  });
  if (error) return { error: friendlyPartyError(error) };

  revalidatePath(`/clients/${partyId}`);
  return { error: null, success: true };
}

export async function getPartyJournalBalanceAction(partyId: string, direction: "receivable" | "payable"): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("fn_party_journal_balance", { p_party_id: partyId, p_direction: direction });
  return data ?? 0;
}

export async function togglePartyActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  if (!isOwner(await getCurrentUser())) return { error: "Only Owner can activate/deactivate a client/supplier." };
  const supabase = await createClient();
  const { error } = await supabase.from("parties").update({ is_active: isActive }).eq("id", id);
  revalidatePath("/clients");
  return { error: error?.message ?? null };
}

// Owner-only, and only once fn_delete_master_row confirms nothing already
// references this party (queries, quotations, orders, invoices, etc.) —
// the Clients/Suppliers list falls back to Deactivate for anything still
// in use.
export async function deletePartyAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_delete_master_row", { p_table: "parties", p_id: id });
  if (error) return { error: friendlyPartyError(error) };
  revalidatePath("/clients");
  return { error: null, success: true };
}

// Smart Merge: `base` is the credit_limit/credit_days this browser tab
// last loaded (i.e. what was on screen when the user opened this
// editor); only the fields that actually changed are sent as `changes`,
// so someone else's concurrent edit to the OTHER field never gets
// clobbered. If the same field was changed by someone else to a
// different value in the meantime, that one field comes back as a
// conflict for the user to resolve — everything else still saves.
export async function updateCreditTermsAction(
  id: string,
  base: { creditLimit: number; creditDays: number },
  next: { creditLimit: number; creditDays: number }
): Promise<ActionResult> {
  if (!Number.isFinite(next.creditLimit) || !Number.isFinite(next.creditDays)) return { error: "Value must be a number." };
  if (next.creditLimit < 0 || next.creditDays < 0) return { error: "Value cannot be negative." };
  if (!Number.isInteger(next.creditDays)) return { error: "Credit days must be a whole number of days." };

  const supabase = await createClient();
  const changes = diffFields(
    { credit_limit: base.creditLimit, credit_days: base.creditDays },
    { credit_limit: next.creditLimit, credit_days: next.creditDays }
  );
  const { result, error } = await smartMergeUpdate(
    supabase,
    "parties",
    id,
    { credit_limit: base.creditLimit, credit_days: base.creditDays },
    changes
  );
  if (error) return { error: friendlyPartyError(error) };
  if (result && result.conflicts.length > 0) {
    return { error: null, conflicts: result.conflicts };
  }

  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  return { error: null, success: true };
}
