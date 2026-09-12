import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";
import { buttonClass } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Receipt } from "lucide-react";

const STATUS_TONE: Record<string, BadgeTone> = {
  Posted: "good",
  Cancelled: "bad",
};

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getCurrentUser();
  const canCreate = await hasPermission(user, "invoice.manage");
  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  const [{ data: invoices, count }, { data: outstanding }] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, parties(legal_name), sales_orders(so_no)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(rangeFrom, rangeTo),
    supabase.from("invoice_outstanding").select("*"),
  ]);
  const totalPages = computeTotalPages(count ?? 0);

  const outstandingById = new Map((outstanding ?? []).map((o) => [o.invoice_id, o.outstanding_amount ?? 0]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">GST Invoices</h1>
          <p className="mt-1 text-sm text-ink-soft">Pakistan FBR Sales Tax (GST) invoices for delivered goods.</p>
        </div>
        {canCreate && (
          <Link href="/invoices/new" className={buttonClass()}>
            + New Invoice
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        {invoices?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="text-left px-4 py-2.5">Invoice #</th>
                  <th className="text-left px-4 py-2.5">Client / SO</th>
                  <th className="text-right px-4 py-2.5">Total</th>
                  <th className="text-right px-4 py-2.5">Outstanding</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const party = inv.parties as unknown as { legal_name: string } | null;
                  const so = inv.sales_orders as unknown as { so_no: string } | null;
                  const outstandingAmt = outstandingById.get(inv.id) ?? 0;
                  return (
                    <tr key={inv.id} className="border-t border-line even:bg-bg hover:bg-surface-2">
                      <td className="px-4 py-2.5">
                        <Link href={`/invoices/${inv.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                          {inv.invoice_no}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-ink-soft text-xs whitespace-nowrap">
                        {party?.legal_name} <span className="text-ink-faint">({so?.so_no})</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular text-ink">{inv.grand_total.toLocaleString()}</td>
                      <td className={`px-4 py-2.5 text-right tabular ${outstandingAmt > 0 ? "text-warn font-medium" : "text-ink-soft"}`}>
                        {inv.status === "Posted" ? outstandingAmt.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={STATUS_TONE[inv.status] ?? "neutral"}>{inv.status}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Receipt size={22} />}
            title="No Invoices yet"
            description="Pakistan FBR Sales Tax (GST) invoices for delivered goods are created here."
            action={
              canCreate ? (
                <Link href="/invoices/new" className={buttonClass()}>
                  + New Invoice
                </Link>
              ) : undefined
            }
          />
        )}
      </div>

      <PaginationControls basePath="/invoices" searchParams={{}} currentPage={page} totalPages={totalPages} totalCount={count ?? 0} />
    </div>
  );
}
