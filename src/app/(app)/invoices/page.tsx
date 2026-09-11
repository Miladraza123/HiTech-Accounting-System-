import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

export default async function InvoicesPage() {
  const user = await getCurrentUser();
  const canCreate = isOwner(user) || hasRole(user, "accounts");

  const supabase = await createClient();
  const [{ data: invoices }, { data: outstanding }] = await Promise.all([
    supabase.from("invoices").select("*, parties(legal_name), sales_orders(so_no)").order("created_at", { ascending: false }),
    supabase.from("invoice_outstanding").select("*"),
  ]);

  const outstandingById = new Map((outstanding ?? []).map((o) => [o.invoice_id, o.outstanding_amount ?? 0]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">GST Invoices</h1>
          <p className="mt-1 text-sm text-ink-soft">Delivered goods par Pakistan FBR Sales Tax (GST) invoice.</p>
        </div>
        {canCreate && (
          <Link href="/invoices/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition">
            + Nayi Invoice
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
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
              {(invoices ?? []).map((inv) => {
                const party = inv.parties as unknown as { legal_name: string } | null;
                const so = inv.sales_orders as unknown as { so_no: string } | null;
                const outstandingAmt = outstandingById.get(inv.id) ?? 0;
                return (
                  <tr key={inv.id} className="border-t border-line hover:bg-surface-2">
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
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[inv.status] ?? ""}`}>{inv.status}</span>
                    </td>
                  </tr>
                );
              })}
              {!invoices?.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                    Koi Invoice nahi hai abhi tak.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
