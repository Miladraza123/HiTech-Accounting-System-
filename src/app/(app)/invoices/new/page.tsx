import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NewInvoiceForm } from "@/components/NewInvoiceForm";

// How many eligible Sales Orders the picker offers at once. The whole eligible
// set used to be sent back to PostgREST as an `.in("id", ids)` filter, which
// lives in the request URL — so a backlog of a few hundred un-invoiced
// deliveries was enough to make the request too large to send, and no invoice
// could be created at all. This is now a fixed-size page, with search for
// anything older.
const PICKER_LIMIT = 50;

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "invoice.manage"))) redirect("/invoices");

  const { q } = await searchParams;
  const term = (q ?? "").trim();

  const supabase = await createClient();
  // Which Sales Orders still have delivered-but-not-yet-invoiced quantity is
  // a column-vs-column test, which PostgREST cannot express — so this page
  // used to fetch every open Sales Order with all of its lines and decide
  // here. fn_invoiceable_sales_orders_page answers it in the database and
  // returns one page of the eligible set, newest first, plus the eligible
  // total, so the request stays the same size however long the backlog gets.
  const { data: eligibleIds } = await supabase.rpc("fn_invoiceable_sales_orders_page", {
    p_search: term,
    p_limit: PICKER_LIMIT,
    p_offset: 0,
  });
  const ids = (eligibleIds ?? []).map((r) => r.id);
  const eligibleTotal = Number(eligibleIds?.[0]?.total_rows ?? 0);

  const { data: salesOrders } = ids.length
    ? await supabase
        .from("sales_orders")
        .select("*, parties(legal_name), sales_order_lines(*)")
        .in("id", ids)
        .order("created_at", { ascending: false })
    : { data: [] };

  const eligible = salesOrders ?? [];

  return (
    <div className="space-y-4">
      <div>
        <Link href="/invoices" className="text-xs text-ink-faint hover:text-ink">
          ← GST Invoices
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">New Invoice</h1>
      </div>

      {/* The picker below is one page of the eligible set, not all of it —
          search reaches an older Sales Order without the request having to
          carry every eligible id. */}
      <form className="flex items-center gap-2 flex-wrap">
        <input
          type="search"
          name="q"
          defaultValue={term}
          placeholder="Search SO #, client PO # or client name"
          className="input !py-1.5 text-sm max-w-xs"
        />
        <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
          Search
        </button>
        <span className="text-xs text-ink-faint">
          {eligibleTotal > eligible.length
            ? `Showing ${eligible.length} of ${eligibleTotal.toLocaleString()} eligible — search to narrow`
            : `${eligibleTotal.toLocaleString()} eligible`}
        </span>
      </form>

      {!eligible.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          {term
            ? `No eligible Sales Order matches "${term}". Clear the search to see the most recent eligible orders.`
            : "No Sales Order found with delivered but not yet invoiced quantity. Invoices are created only for delivered quantity."}{" "}
          <Link href="/delivery-challans" className="underline underline-offset-2 font-medium">
            View Delivery Challans
          </Link>
          .
        </div>
      ) : (
        <NewInvoiceForm
          salesOrders={eligible.map((so) => ({
            id: so.id,
            so_no: so.so_no,
            business_line: so.business_line,
            parties: so.parties as unknown as { legal_name: string } | null,
            lines: (so.sales_order_lines as unknown as {
              id: string;
              description: string;
              delivered_qty: number;
              invoiced_qty: number;
              unit: string | null;
              rate: number;
              tax_pct: number;
            }[]).filter((l) => l.invoiced_qty < l.delivered_qty),
          }))}
        />
      )}
    </div>
  );
}
