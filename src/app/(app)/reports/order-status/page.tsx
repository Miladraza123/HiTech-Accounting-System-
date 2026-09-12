import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

export default async function OrderStatusReportPage({ searchParams }: { searchParams: Promise<{ so_id?: string }> }) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "sales") || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const { so_id } = await searchParams;

  const supabase = await createClient();
  const { data: salesOrders } = await supabase
    .from("sales_orders")
    .select("id, so_no, client_po_number, parties(legal_name)")
    .order("created_at", { ascending: false });

  let chain: {
    query: { query_no: string; status: string } | null;
    quotation: { quotation_no: string; status: string } | null;
    so: { so_no: string; status: string; business_line: string; grand_total: number | null } | null;
    jobs: { job_no: string; status: string }[];
    dcs: { dc_no: string; status: string; acceptance_status: string }[];
    invoices: { id: string; invoice_no: string; status: string; grand_total: number }[];
    payments: { payment_no: string; amount: number; payment_date: string }[];
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
      const { data: allocations } = invoiceIds.length
        ? await supabase.from("payment_allocations").select("amount, payments(payment_no, payment_date, status)").in("invoice_id", invoiceIds)
        : { data: [] };

      const payments = (allocations ?? [])
        .map((a) => {
          const pay = a.payments as unknown as { payment_no: string; payment_date: string; status: string } | null;
          return pay && pay.status === "Posted" ? { payment_no: pay.payment_no, amount: a.amount, payment_date: pay.payment_date } : null;
        })
        .filter((p): p is { payment_no: string; amount: number; payment_date: string } => p !== null);

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
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Order-wise Status</h1>
        <p className="text-sm text-ink-soft">Ek Sales Order ka poora safar — Query se Payment tak, ek hi jaga.</p>
      </div>

      <form className="flex items-center gap-2 flex-wrap">
        <select name="so_id" defaultValue={so_id ?? ""} className="input !py-1.5 text-sm max-w-sm">
          <option value="">— Sales Order select karen —</option>
          {(salesOrders ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.so_no} — {(s.parties as unknown as { legal_name: string } | null)?.legal_name} (PO: {s.client_po_number})
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
          Dekhen
        </button>
      </form>

      {chain && (
        <div className="space-y-4">
          <Stage title="Query" items={chain.query ? [{ label: chain.query.query_no, status: chain.query.status }] : []} empty="Koi Query linked nahi." />
          <Stage
            title="Quotation"
            items={chain.quotation ? [{ label: chain.quotation.quotation_no, status: chain.quotation.status }] : []}
            empty="Koi Quotation linked nahi."
          />
          <Stage
            title="Sales Order"
            items={chain.so ? [{ label: `${chain.so.so_no} — ${(chain.so.grand_total ?? 0).toLocaleString()}`, status: chain.so.status }] : []}
            empty="—"
          />
          {chain.so?.business_line === "fabrication" && (
            <Stage title="Fabrication Jobs" items={chain.jobs.map((j) => ({ label: j.job_no, status: j.status }))} empty="Koi Job nahi bani abhi tak." />
          )}
          <Stage
            title="Delivery Challans"
            items={chain.dcs.map((d) => ({ label: d.dc_no, status: `${d.status} / ${d.acceptance_status}` }))}
            empty="Koi Delivery Challan nahi bani abhi tak."
          />
          <Stage
            title="Invoices"
            items={chain.invoices.map((i) => ({ label: `${i.invoice_no} — ${i.grand_total.toLocaleString()}`, status: i.status }))}
            empty="Koi Invoice nahi bani abhi tak."
          />
          <Stage
            title="Payments"
            items={chain.payments.map((p) => ({ label: `${p.payment_no} (${p.payment_date})`, status: p.amount.toLocaleString() }))}
            empty="Koi Payment allocate nahi hui abhi tak."
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
