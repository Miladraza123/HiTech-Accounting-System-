import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

type ResultGroup = { title: string; items: { label: string; sub?: string; href: string }[] };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const groups: ResultGroup[] = [];

  if (query.length >= 2) {
    // Commas/parens are structural separators in PostgREST's .or() filter
    // syntax — strip them from the search value so a query containing them
    // (e.g. "Ali, Khan & Sons") can't break the filter string.
    const safeQuery = query.replace(/[,()]/g, " ").trim();
    const like = `%${safeQuery}%`;
    const supabase = await createClient();

    const [
      { data: parties },
      { data: queries },
      { data: quotations },
      { data: salesOrders },
      { data: purchaseOrders },
      { data: jobs },
      { data: dcs },
      { data: invoices },
      { data: bills },
      { data: items },
      { data: vehicles },
    ] = await Promise.all([
      supabase.from("parties").select("id, legal_name, party_type").ilike("legal_name", like).limit(10),
      supabase.from("queries").select("id, query_no, requirement").or(`query_no.ilike.${like},requirement.ilike.${like}`).limit(10),
      supabase.from("quotations").select("id, quotation_no").ilike("quotation_no", like).limit(10),
      supabase.from("sales_orders").select("id, so_no, client_po_number").or(`so_no.ilike.${like},client_po_number.ilike.${like}`).limit(10),
      supabase.from("purchase_orders").select("id, po_no").ilike("po_no", like).limit(10),
      supabase.from("jobs").select("id, job_no, description").or(`job_no.ilike.${like},description.ilike.${like}`).limit(10),
      supabase.from("delivery_challans").select("id, dc_no").ilike("dc_no", like).limit(10),
      supabase.from("invoices").select("id, invoice_no").ilike("invoice_no", like).limit(10),
      supabase.from("supplier_bills").select("id, bill_no").ilike("bill_no", like).limit(10),
      supabase.from("items").select("id, item_code, description").or(`item_code.ilike.${like},description.ilike.${like}`).limit(10),
      supabase.from("vehicles").select("id, vehicle_no, make_model").ilike("vehicle_no", like).limit(10),
    ]);

    if (parties?.length)
      groups.push({
        title: "Clients / Suppliers",
        items: parties.map((p) => ({ label: p.legal_name, sub: p.party_type, href: `/clients/${p.id}` })),
      });
    if (queries?.length)
      groups.push({ title: "Queries", items: queries.map((q) => ({ label: q.query_no, sub: q.requirement ?? undefined, href: `/queries/${q.id}` })) });
    if (quotations?.length)
      groups.push({ title: "Quotations", items: quotations.map((q) => ({ label: q.quotation_no, href: `/quotations/${q.id}` })) });
    if (salesOrders?.length)
      groups.push({
        title: "Sales Orders",
        items: salesOrders.map((s) => ({ label: s.so_no, sub: `PO: ${s.client_po_number}`, href: `/sales-orders/${s.id}` })),
      });
    if (purchaseOrders?.length)
      groups.push({ title: "Purchase Orders", items: purchaseOrders.map((p) => ({ label: p.po_no, href: `/purchase-orders/${p.id}` })) });
    if (jobs?.length)
      groups.push({ title: "Jobs", items: jobs.map((j) => ({ label: j.job_no, sub: j.description, href: `/jobs/${j.id}` })) });
    if (dcs?.length) groups.push({ title: "Delivery Challans", items: dcs.map((d) => ({ label: d.dc_no, href: `/delivery-challans/${d.id}` })) });
    if (invoices?.length) groups.push({ title: "Invoices", items: invoices.map((i) => ({ label: i.invoice_no, href: `/invoices/${i.id}` })) });
    if (bills?.length) groups.push({ title: "Supplier Bills", items: bills.map((b) => ({ label: b.bill_no, href: `/supplier-bills/${b.id}` })) });
    if (items?.length)
      groups.push({ title: "Items", items: items.map((i) => ({ label: i.item_code, sub: i.description, href: `/items/${i.id}` })) });
    if (vehicles?.length)
      groups.push({ title: "Vehicles", items: vehicles.map((v) => ({ label: v.vehicle_no, sub: v.make_model ?? undefined, href: `/setup/vehicles/${v.id}` })) });
  }

  const totalResults = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Search</h1>
        <p className="mt-1 text-sm text-ink-soft">Client, Supplier, Query#, Quotation#, PO#, Job#, DC#, Invoice#, Item, Vehicle — sab ek jaga.</p>
      </div>

      <form className="max-w-lg">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Search karen…"
          autoFocus
          className="input"
        />
      </form>

      {query.length > 0 && query.length < 2 && <p className="text-sm text-ink-faint">Kam az kam 2 characters likhen.</p>}

      {query.length >= 2 && (
        <>
          <p className="text-xs text-ink-faint">
            &quot;{query}&quot; ke liye {totalResults} result{totalResults === 1 ? "" : "s"} mile.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {groups.map((g) => (
              <div key={g.title} className="rounded-xl border border-line bg-surface overflow-hidden">
                <div className="px-4 py-2.5 border-b border-line bg-surface-2">
                  <h2 className="text-sm font-semibold text-ink">{g.title}</h2>
                </div>
                <ul className="divide-y divide-line">
                  {g.items.map((it, i) => (
                    <li key={i}>
                      <Link href={it.href} className="flex flex-col px-4 py-2.5 text-sm hover:bg-surface-2 transition">
                        <span className="text-ink font-mono text-xs">{it.label}</span>
                        {it.sub && <span className="text-ink-faint text-xs mt-0.5 truncate">{it.sub}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {!groups.length && (
              <p className="text-sm text-ink-faint col-span-2">Koi result nahi mila &quot;{query}&quot; ke liye.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
