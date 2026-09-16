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
  //
  // The allocation table is NOT pre-loaded for every party any more. This page
  // used to fetch the entire invoice_outstanding and supplier_bill_outstanding
  // views — 118,763 rows and 22 MB of JSON at 120,000 invoices — and filter
  // them in the browser down to the one party being paid. Only the
  // pre-selected party's documents are fetched here (so a ?party= link still
  // renders complete from a cached page with no network); the form asks for
  // any other party's when it is picked.
  const [{ data: clientParties }, { data: supplierParties }, { data: bankAccounts }, { data: pettyCashFunds }, { data: defaultParty }] =
    await Promise.all([
      supabase.from("parties").select("id, legal_name").eq("is_active", true).in("party_type", ["client", "both"]).order("legal_name").limit(20),
      supabase.from("parties").select("id, legal_name").eq("is_active", true).in("party_type", ["supplier", "both"]).order("legal_name").limit(20),
      supabase.from("bank_accounts").select("*").eq("is_active", true).order("account_name"),
      supabase.from("petty_cash_funds").select("*").eq("is_active", true).order("fund_name"),
      // The party may be pre-chosen via ?party=<id> (e.g. arriving from a
      // client page). The picker needs its NAME to show, not just its id —
      // and the same eligibility rule the dropdown enforces is applied here
      // too, so a ?party= pointing at a supplier cannot pre-fill a Receipt.
      party
        ? supabase.from("parties").select("id, legal_name").eq("id", party).eq("is_active", true).in("party_type", initialPartyTypes).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const { data: initialOutstanding } = defaultParty
    ? await supabase.rpc("fn_party_outstanding", { p_party_id: defaultParty.id, p_direction: initialDirection, p_limit: 100 })
    : { data: [] };

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
        initialOutstanding={initialOutstanding ?? []}
        bankAccounts={bankAccounts ?? []}
        pettyCashFunds={pettyCashFunds ?? []}
      />
    </div>
  );
}
