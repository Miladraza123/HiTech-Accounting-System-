import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { EditCreditTermsForm } from "@/components/EditCreditTermsForm";

const TYPE_LABEL: Record<string, string> = { client: "Client", supplier: "Supplier", both: "Client + Supplier" };

function agingBucket(dueDate: string): "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus" {
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export default async function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const owner = isOwner(user);

  const supabase = await createClient();
  const [{ data: party }, { data: arSummary }, { data: apSummary }] = await Promise.all([
    supabase.from("parties").select("*").eq("id", id).maybeSingle(),
    supabase.from("party_ar_summary").select("*").eq("party_id", id).maybeSingle(),
    supabase.from("party_ap_summary").select("*").eq("supplier_id", id).maybeSingle(),
  ]);

  if (!party) notFound();

  const isClient = party.party_type === "client" || party.party_type === "both";
  const isSupplier = party.party_type === "supplier" || party.party_type === "both";

  const [
    { data: queries },
    { data: quotations },
    { data: salesOrders },
    { data: deliveryChallans },
    { data: invoices },
    { data: invoiceOutstanding },
    { data: purchaseOrders },
    { data: supplierBills },
    { data: payments },
  ] = await Promise.all([
    isClient ? supabase.from("queries").select("*").eq("party_id", id).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    isClient ? supabase.from("quotations").select("*").eq("party_id", id).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    isClient ? supabase.from("sales_orders").select("*").eq("party_id", id).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    isClient ? supabase.from("delivery_challans").select("*").eq("party_id", id).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    isClient ? supabase.from("invoices").select("*").eq("party_id", id).order("created_at", { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
    isClient ? supabase.from("invoice_outstanding").select("*").eq("party_id", id) : Promise.resolve({ data: [] }),
    isSupplier ? supabase.from("purchase_orders").select("*").eq("supplier_id", id).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    isSupplier ? supabase.from("supplier_bills").select("*").eq("supplier_id", id).order("created_at", { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
    supabase.from("payments").select("*").eq("party_id", id).order("created_at", { ascending: false }).limit(20),
  ]);

  const totalReceivable = arSummary?.total_outstanding ?? 0;
  const totalPayable = apSummary?.total_outstanding ?? 0;
  const creditLimit = party.credit_limit ?? 0;
  const availableCredit = creditLimit > 0 ? creditLimit - totalReceivable : null;
  const overLimit = creditLimit > 0 && totalReceivable > creditLimit;

  // AR aging for this client's still-outstanding invoices
  const outstandingByInvoiceId = new Map((invoiceOutstanding ?? []).map((o) => [o.invoice_id, o.outstanding_amount ?? 0]));
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const inv of invoices ?? []) {
    const out = outstandingByInvoiceId.get(inv.id) ?? 0;
    if (inv.status !== "Posted" || out <= 0.005) continue;
    const dueDate = new Date(inv.invoice_date);
    dueDate.setDate(dueDate.getDate() + (party.credit_days ?? 0));
    buckets[agingBucket(dueDate.toISOString().slice(0, 10))] += out;
  }
  const hasOpenInvoices = Object.values(buckets).some((v) => v > 0.005);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/clients" className="text-xs text-ink-faint hover:text-ink">
          ← Clients &amp; Suppliers
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-ink">{party.legal_name}</h1>
          <span className="rounded-full bg-ledger-soft px-2 py-0.5 text-xs font-mono text-ledger">{TYPE_LABEL[party.party_type] ?? party.party_type}</span>
          {!party.is_active && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-faint">Inactive</span>}
        </div>
        <p className="text-sm text-ink-soft mt-0.5">
          {[party.ntn && `NTN: ${party.ntn}`, party.strn && `STRN: ${party.strn}`, party.cnic && `CNIC: ${party.cnic}`].filter(Boolean).join(" · ") || "—"}
        </p>
        {party.billing_address && <p className="text-xs text-ink-faint mt-0.5">{party.billing_address}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isClient && (
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className={`text-2xl font-semibold tabular ${totalReceivable > 0 ? "text-warn" : "text-ink"}`}>{totalReceivable.toLocaleString()}</p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Outstanding Receivable</p>
          </div>
        )}
        {isClient && (
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className={`text-2xl font-semibold tabular ${overLimit ? "text-bad" : "text-ink"}`}>
              {creditLimit > 0 ? creditLimit.toLocaleString() : "Unlimited"}
            </p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Credit Limit</p>
          </div>
        )}
        {isClient && creditLimit > 0 && (
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className={`text-2xl font-semibold tabular ${(availableCredit ?? 0) < 0 ? "text-bad" : "text-good"}`}>
              {(availableCredit ?? 0).toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Available Credit</p>
          </div>
        )}
        {isSupplier && (
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className={`text-2xl font-semibold tabular ${totalPayable > 0 ? "text-warn" : "text-ink"}`}>{totalPayable.toLocaleString()}</p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Outstanding Payable</p>
          </div>
        )}
      </div>

      {owner && isClient && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Credit Terms</h2>
            <EditCreditTermsForm partyId={id} creditLimit={creditLimit} creditDays={party.credit_days ?? 0} />
          </div>
          <p className="text-xs text-ink-soft">Credit Days: {party.credit_days ?? 0} — invoice due date = invoice date + credit days.</p>
          {overLimit && (
            <p className="rounded-md bg-bad-soft px-3 py-2 text-xs text-bad">
              ⚠ Yeh client apni credit limit se {(totalReceivable - creditLimit).toLocaleString()} zyada outstanding rakhta hai.
            </p>
          )}
        </div>
      )}

      {isClient && hasOpenInvoices && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line">
            <h2 className="text-sm font-semibold text-ink">AR Aging</h2>
          </div>
          <div className="grid grid-cols-5 text-center text-sm">
            {(
              [
                ["current", "Current"],
                ["d1_30", "1-30 din"],
                ["d31_60", "31-60 din"],
                ["d61_90", "61-90 din"],
                ["d90_plus", "90+ din"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="px-3 py-3 border-r border-line last:border-r-0">
                <p className={`tabular font-semibold ${key !== "current" && buckets[key] > 0 ? "text-bad" : "text-ink"}`}>{buckets[key].toLocaleString()}</p>
                <p className="text-[11px] text-ink-faint mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isClient && (
          <RecordSection
            title="Queries"
            rows={(queries ?? []).map((q) => ({ id: q.id, label: q.query_no, href: `/queries/${q.id}`, sub: q.status, date: q.created_at }))}
          />
        )}
        {isClient && (
          <RecordSection
            title="Quotations"
            rows={(quotations ?? []).map((q) => ({ id: q.id, label: q.quotation_no, href: `/quotations/${q.id}`, sub: q.status, date: q.created_at }))}
          />
        )}
        {isClient && (
          <RecordSection
            title="Sales Orders"
            rows={(salesOrders ?? []).map((s) => ({ id: s.id, label: s.so_no, href: `/sales-orders/${s.id}`, sub: s.status, date: s.created_at, amount: s.grand_total }))}
          />
        )}
        {isClient && (
          <RecordSection
            title="Delivery Challans"
            rows={(deliveryChallans ?? []).map((d) => ({ id: d.id, label: d.dc_no, href: `/delivery-challans/${d.id}`, sub: `${d.status} / ${d.acceptance_status}`, date: d.created_at }))}
          />
        )}
        {isClient && (
          <RecordSection
            title="Invoices"
            rows={(invoices ?? []).map((i) => ({ id: i.id, label: i.invoice_no, href: `/invoices/${i.id}`, sub: i.status, date: i.created_at, amount: i.grand_total }))}
          />
        )}
        {isSupplier && (
          <RecordSection
            title="Purchase Orders"
            rows={(purchaseOrders ?? []).map((p) => ({ id: p.id, label: p.po_no, href: `/purchase-orders/${p.id}`, sub: p.status, date: p.created_at, amount: p.grand_total }))}
          />
        )}
        {isSupplier && (
          <RecordSection
            title="Supplier Bills"
            rows={(supplierBills ?? []).map((b) => ({ id: b.id, label: b.bill_no, href: `/supplier-bills/${b.id}`, sub: b.status, date: b.created_at, amount: b.grand_total }))}
          />
        )}
        <RecordSection
          title="Payments"
          rows={(payments ?? []).map((p) => ({
            id: p.id,
            label: p.payment_no,
            href: `/payments/${p.id}`,
            sub: `${p.direction === "receipt" ? "Receipt" : "Payment"} / ${p.status}`,
            date: p.created_at,
            amount: p.amount,
          }))}
        />
      </div>
    </div>
  );
}

function RecordSection({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; label: string; href: string; sub: string; date: string; amount?: number }[];
}) {
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      <ul className="divide-y divide-line max-h-72 overflow-y-auto">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <div>
              <Link href={r.href} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                {r.label}
              </Link>
              <span className="ml-2 text-xs text-ink-faint">{r.sub}</span>
            </div>
            <div className="flex items-center gap-3">
              {r.amount !== undefined && <span className="tabular text-xs text-ink-soft">{r.amount.toLocaleString()}</span>}
              <span className="text-[11px] text-ink-faint whitespace-nowrap">{new Date(r.date).toLocaleDateString("en-PK")}</span>
            </div>
          </li>
        ))}
        {!rows.length && <li className="px-4 py-4 text-center text-ink-faint text-xs">Koi record nahi hai.</li>}
      </ul>
    </div>
  );
}
