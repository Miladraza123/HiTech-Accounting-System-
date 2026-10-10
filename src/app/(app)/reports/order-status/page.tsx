import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { canSeeFinance } from "@/lib/financeAccess";
import { PrintPdfActions } from "@/components/PrintPdfActions";

// How many Sales Orders the picker offers at once. This page exists to look up
// ONE order, so the list is a search result, not the whole order book.
const PICKER_LIMIT = 25;

export default async function OrderStatusReportPage({ searchParams }: { searchParams: Promise<{ so_id?: string; q?: string }> }) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "sales") || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const { so_id, q } = await searchParams;
  const term = (q ?? "").trim();
  // PostgREST's .or() takes its filters as one comma-separated string, so a
  // comma, parenthesis or quote typed into the search box would be read as
  // filter syntax rather than as text. Dropping those characters keeps the
  // search a search. (This is a parsing concern, not an injection one — the
  // values still travel as PostgREST filters, never as SQL.)
  const safeTerm = term.replace(/[,()"\\]/g, " ").trim();

  const supabase = await createClient();
  // The picker used to be a <select> holding every Sales Order ever raised.
  // At 120,000 orders that is 15.6 MB of JSON and 120,000 <option> elements
  // rendered on a page whose whole purpose is to open one of them. It is now
  // the most recent PICKER_LIMIT, or the matches for what was typed, searched
  // in the database. Searching by client name resolves the name to party ids
  // first, because PostgREST cannot filter a parent by an embedded column.
  let matchedPartyIds: string[] = [];
  if (safeTerm) {
    const { data: parties } = await supabase
      .from("parties")
      .select("id")
      .ilike("legal_name", `%${safeTerm}%`)
      .limit(50);
    matchedPartyIds = (parties ?? []).map((p) => p.id);
  }

  let pickerQuery = supabase.from("sales_orders").select("id, so_no, client_po_number, parties(legal_name)");
  if (safeTerm) {
    const clauses = [`so_no.ilike.%${safeTerm}%`, `client_po_number.ilike.%${safeTerm}%`];
    if (matchedPartyIds.length) clauses.push(`party_id.in.(${matchedPartyIds.join(",")})`);
    pickerQuery = pickerQuery.or(clauses.join(","));
  }
  const [{ data: pickerRows }, { data: company }] = await Promise.all([
    pickerQuery.order("created_at", { ascending: false }).limit(PICKER_LIMIT),
    supabase.from("company").select("signature_path, stamp_path, phone, email").maybeSingle(),
  ]);

  // Whatever is currently being viewed must stay in the list even when it
  // falls outside the current search, or the dropdown would read
  // "— Select Sales Order —" while its chain is shown underneath.
  const { data: selectedRow } =
    so_id && !(pickerRows ?? []).some((r) => r.id === so_id)
      ? await supabase.from("sales_orders").select("id, so_no, client_po_number, parties(legal_name)").eq("id", so_id).maybeSingle()
      : { data: null };
  const salesOrders = selectedRow ? [selectedRow, ...(pickerRows ?? [])] : (pickerRows ?? []);

  let chain: {
    query: { query_no: string; status: string } | null;
    quotation: { quotation_no: string; status: string } | null;
    so: { so_no: string; status: string; business_line: string; grand_total: number | null } | null;
    jobs: { job_no: string; status: string }[];
    dcs: { dc_no: string; status: string; acceptance_status: string }[];
    invoices: { id: string; invoice_no: string; status: string; grand_total: number }[];
    payments: { label: string; status: string }[];
  } | null = null;

  if (so_id) {
    const { data: so } = await supabase
      .from("sales_orders")
      .select("*, queries(query_no, status), quotations(quotation_no, status)")
      .eq("id", so_id)
      .maybeSingle();

    if (so) {
      const [{ data: jobs }, { data: dcs }, { data: invoices }] = await Promise.all([
        supabase.from("jobs").select("job_no, status").eq("sales_order_id", so_id),
        supabase.from("delivery_challans").select("dc_no, status, acceptance_status").eq("sales_order_id", so_id),
        supabase.from("invoices").select("id, invoice_no, status, grand_total").eq("sales_order_id", so_id),
      ]);

      const invoiceIds = (invoices ?? []).map((i) => i.id);
      // Payments are finance-only in RLS. Sales still sees how much of each
      // invoice has been received, via invoice_outstanding (allocated totals
      // only, no payment documents).
      const financeView = canSeeFinance(user);
      const { data: allocations } =
        financeView && invoiceIds.length
          ? await supabase.from("payment_allocations").select("amount, payments(payment_no, payment_date, status)").in("invoice_id", invoiceIds)
          : { data: [] };
      const { data: received } =
        !financeView && invoiceIds.length
          ? await supabase.from("invoice_outstanding").select("invoice_id, allocated_amount, outstanding_amount").in("invoice_id", invoiceIds)
          : { data: [] };
      const invoiceNoById = new Map((invoices ?? []).map((i) => [i.id, i.invoice_no]));

      const payments = financeView
        ? (allocations ?? [])
            .map((a) => {
              const pay = a.payments as unknown as { payment_no: string; payment_date: string; status: string } | null;
              return pay && pay.status === "Posted" ? { label: `${pay.payment_no} (${pay.payment_date})`, status: a.amount.toLocaleString() } : null;
            })
            .filter((p): p is { label: string; status: string } => p !== null)
        : (received ?? [])
            .filter((r) => (r.allocated_amount ?? 0) > 0)
            .map((r) => ({
              label: `${invoiceNoById.get(r.invoice_id ?? "") ?? "Invoice"} — received ${(r.allocated_amount ?? 0).toLocaleString()}`,
              status: `Outstanding ${(r.outstanding_amount ?? 0).toLocaleString()}`,
            }));

      chain = {
        query: so.queries as unknown as { query_no: string; status: string } | null,
        quotation: so.quotations as unknown as { quotation_no: string; status: string } | null,
        so: { so_no: so.so_no, status: so.status, business_line: so.business_line, grand_total: so.grand_total },
        jobs: jobs ?? [],
        dcs: dcs ?? [],
        invoices: invoices ?? [],
        payments,
      };
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
            ← Reports
          </Link>
          <h1 className="text-lg font-semibold text-ink mt-1">Order-wise Status</h1>
          <p className="text-sm text-ink-soft">The complete journey of a Sales Order — from Query to Payment, all in one place.</p>
        </div>
        {chain && so_id && (
          <PrintPdfActions
            printPath={`/reports/order-status/print?so_id=${so_id}`}
            filename={`Order-Status-${chain.so?.so_no ?? so_id}.pdf`}
            hasSignature={!!company?.signature_path}
            hasStamp={!!company?.stamp_path}
            hasPhone={!!company?.phone}
            hasEmail={!!company?.email}
          />
        )}
      </div>

      <form className="flex items-center gap-2 flex-wrap">
        <input
          type="search"
          name="q"
          defaultValue={term}
          placeholder="Search SO #, client PO # or client name"
          className="input !py-1.5 text-sm max-w-xs"
        />
        <select name="so_id" defaultValue={so_id ?? ""} className="input !py-1.5 text-sm max-w-sm">
          <option value="">— Select Sales Order —</option>
          {salesOrders.map((s) => (
            <option key={s.id} value={s.id}>
              {s.so_no} — {(s.parties as unknown as { legal_name: string } | null)?.legal_name} (PO: {s.client_po_number})
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
          View
        </button>
        <span className="text-xs text-ink-faint">
          {term
            ? `${(pickerRows ?? []).length} match${(pickerRows ?? []).length === 1 ? "" : "es"}${(pickerRows ?? []).length === PICKER_LIMIT ? " (narrow the search for more)" : ""}`
            : `Showing the ${(pickerRows ?? []).length} most recent — search to find an older one`}
        </span>
      </form>

      {chain && (
        <div className="space-y-4">
          <Stage title="Query" items={chain.query ? [{ label: chain.query.query_no, status: chain.query.status }] : []} empty="No Query linked." />
          <Stage
            title="Quotation"
            items={chain.quotation ? [{ label: chain.quotation.quotation_no, status: chain.quotation.status }] : []}
            empty="No Quotation linked."
          />
          <Stage
            title="Sales Order"
            items={chain.so ? [{ label: `${chain.so.so_no} — ${(chain.so.grand_total ?? 0).toLocaleString()}`, status: chain.so.status }] : []}
            empty="—"
          />
          {chain.so?.business_line === "fabrication" && (
            <Stage title="Fabrication Jobs" items={chain.jobs.map((j) => ({ label: j.job_no, status: j.status }))} empty="No Job created yet." />
          )}
          <Stage
            title="Delivery Challans"
            items={chain.dcs.map((d) => ({ label: d.dc_no, status: `${d.status} / ${d.acceptance_status}` }))}
            empty="No Delivery Challan created yet."
          />
          <Stage
            title="Invoices"
            items={chain.invoices.map((i) => ({ label: `${i.invoice_no} — ${i.grand_total.toLocaleString()}`, status: i.status }))}
            empty="No Invoice created yet."
          />
          <Stage
            title="Payments"
            items={chain.payments}
            empty="No Payment allocated yet."
          />
        </div>
      )}
    </div>
  );
}

function Stage({ title, items, empty }: { title: string; items: { label: string; status: string }[]; empty: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line bg-surface-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      {items.length ? (
        <ul className="divide-y divide-line">
          {items.map((it, i) => (
            <li key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-ink font-mono text-xs">{it.label}</span>
              <span className="text-ink-soft text-xs">{it.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-center text-ink-faint text-xs">{empty}</p>
      )}
    </div>
  );
}
