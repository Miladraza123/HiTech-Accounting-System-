import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NewPaymentForm } from "@/components/NewPaymentForm";

export default async function NewPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ party?: string; direction?: string }>;
}) {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "payment.manage"))) redirect("/payments");

  const { party, direction } = await searchParams;
  const initialDirection = direction === "payment" ? "payment" : "receipt";
  const initialPartyTypes = initialDirection === "receipt" ? ["client", "both"] : ["supplier", "both"];

  const supabase = await createClient();
  // Only a first page of each party list, and only the columns the picker
  // renders — the rest are found by typing, which searches in the database.
  // Two lists because the eligible set flips with the direction toggle: a
  // Receipt may only be from a client, a Payment only to a supplier.
  const [{ data: clientParties }, { data: supplierParties }, { data: invoiceOutstanding }, { data: billOutstanding }, { data: bankAccounts }, { data: pettyCashFunds }] =
    await Promise.all([
      supabase.from("parties").select("id, legal_name").eq("is_active", true).in("party_type", ["client", "both"]).order("legal_name").limit(20),
      supabase.from("parties").select("id, legal_name").eq("is_active", true).in("party_type", ["supplier", "both"]).order("legal_name").limit(20),
      supabase.from("invoice_outstanding").select("*").gt("outstanding_amount", 0),
      supabase.from("supplier_bill_outstanding").select("*").gt("outstanding_amount", 0),
      supabase.from("bank_accounts").select("*").eq("is_active", true).order("account_name"),
      supabase.from("petty_cash_funds").select("*").eq("is_active", true).order("fund_name"),
    ]);

  // Look up the document numbers for exactly the outstanding rows above,
  // instead of pulling every invoice and every supplier bill ever raised
  // just to label a handful of allocation lines.
  const invoiceIds = (invoiceOutstanding ?? []).map((o) => o.invoice_id!).filter(Boolean);
  const billIds = (billOutstanding ?? []).map((o) => o.supplier_bill_id!).filter(Boolean);
  const [{ data: invoices }, { data: bills }, { data: defaultParty }] = await Promise.all([
    invoiceIds.length
      ? supabase.from("invoices").select("id, invoice_no, invoice_date").in("id", invoiceIds)
      : Promise.resolve({ data: [] as { id: string; invoice_no: string; invoice_date: string }[] }),
    billIds.length
      ? supabase.from("supplier_bills").select("id, bill_no, bill_date").in("id", billIds)
      : Promise.resolve({ data: [] as { id: string; bill_no: string; bill_date: string }[] }),
    // The party may be pre-chosen via ?party=<id> (e.g. arriving from a
    // client page). The picker needs its NAME to show, not just its id —
    // and the same eligibility rule the dropdown enforces is applied here
    // too, so a ?party= pointing at a supplier cannot pre-fill a Receipt.
    party
      ? supabase.from("parties").select("id, legal_name").eq("id", party).eq("is_active", true).in("party_type", initialPartyTypes).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const invoiceById = new Map((invoices ?? []).map((i) => [i.id, i]));
  const billById = new Map((bills ?? []).map((b) => [b.id, b]));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/payments" className="text-xs text-ink-faint hover:text-ink">
            ← Payments
          </Link>
          <h1 className="text-lg font-semibold text-ink mt-1">New Payment</h1>
        </div>
        <Link href="/payments/new/batch" className="text-xs text-accent-ink underline underline-offset-2 whitespace-nowrap">
          Record multiple at once →
        </Link>
      </div>

      <NewPaymentForm
        clientParties={clientParties ?? []}
        supplierParties={supplierParties ?? []}
        defaultParty={defaultParty ? { id: defaultParty.id, label: defaultParty.legal_name } : null}
        defaultDirection={initialDirection}
        outstandingInvoices={(invoiceOutstanding ?? []).map((o) => ({
          invoice_id: o.invoice_id!,
          party_id: o.party_id!,
          outstanding_amount: o.outstanding_amount ?? 0,
          invoice_no: invoiceById.get(o.invoice_id!)?.invoice_no ?? "",
          invoice_date: invoiceById.get(o.invoice_id!)?.invoice_date ?? "",
        }))}
        outstandingBills={(billOutstanding ?? []).map((o) => ({
          supplier_bill_id: o.supplier_bill_id!,
          supplier_id: o.supplier_id!,
          outstanding_amount: o.outstanding_amount ?? 0,
          bill_no: billById.get(o.supplier_bill_id!)?.bill_no ?? "",
          bill_date: billById.get(o.supplier_bill_id!)?.bill_date ?? "",
        }))}
        bankAccounts={bankAccounts ?? []}
        pettyCashFunds={pettyCashFunds ?? []}
      />
    </div>
  );
}
