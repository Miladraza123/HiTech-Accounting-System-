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

  const supabase = await createClient();
  const [{ data: parties }, { data: invoiceOutstanding }, { data: invoices }, { data: billOutstanding }, { data: bills }, { data: bankAccounts }, { data: pettyCashFunds }] = await Promise.all([
    supabase.from("parties").select("*").eq("is_active", true).order("legal_name"),
    supabase.from("invoice_outstanding").select("*").gt("outstanding_amount", 0),
    supabase.from("invoices").select("id, invoice_no, invoice_date"),
    supabase.from("supplier_bill_outstanding").select("*").gt("outstanding_amount", 0),
    supabase.from("supplier_bills").select("id, bill_no, bill_date"),
    supabase.from("bank_accounts").select("*").eq("is_active", true).order("account_name"),
    supabase.from("petty_cash_funds").select("*").eq("is_active", true).order("fund_name"),
  ]);

  const invoiceById = new Map((invoices ?? []).map((i) => [i.id, i]));
  const billById = new Map((bills ?? []).map((b) => [b.id, b]));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/payments" className="text-xs text-ink-faint hover:text-ink">
          ← Payments
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Naya Payment</h1>
      </div>

      <NewPaymentForm
        parties={parties ?? []}
        defaultPartyId={party ?? ""}
        defaultDirection={direction === "payment" ? "payment" : direction === "receipt" ? "receipt" : "receipt"}
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
