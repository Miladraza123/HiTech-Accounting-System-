import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

const STATUS_STYLE: Record<string, string> = {
  Issued: "bg-ledger-soft text-ledger",
  Cancelled: "bg-bad-soft text-bad",
};

const ACCEPTANCE_STYLE: Record<string, string> = {
  Pending: "bg-warn-soft text-warn",
  Accepted: "bg-good-soft text-good",
  Disputed: "bg-bad-soft text-bad",
};

export default async function DeliveryChallansPage() {
  const user = await getCurrentUser();
  const canCreate = await hasPermission(user, "delivery_challan.manage");

  const supabase = await createClient();
  const { data: dcs } = await supabase
    .from("delivery_challans")
    .select("*, parties(legal_name), sales_orders(so_no)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Delivery Challans</h1>
          <p className="mt-1 text-sm text-ink-soft">Dispatch aur Client Acceptance / POD.</p>
        </div>
        {canCreate && (
          <Link href="/delivery-challans/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition">
            + Nayi DC
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">DC #</th>
                <th className="text-left px-4 py-2.5">Client / SO</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Acceptance</th>
              </tr>
            </thead>
            <tbody>
              {(dcs ?? []).map((dc) => {
                const party = dc.parties as unknown as { legal_name: string } | null;
                const so = dc.sales_orders as unknown as { so_no: string } | null;
                return (
                  <tr key={dc.id} className="border-t border-line hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/delivery-challans/${dc.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                        {dc.dc_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft text-xs whitespace-nowrap">
                      {party?.legal_name} <span className="text-ink-faint">({so?.so_no})</span>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">{dc.delivery_date}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[dc.status] ?? ""}`}>{dc.status}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${ACCEPTANCE_STYLE[dc.acceptance_status] ?? ""}`}>{dc.acceptance_status}</span>
                    </td>
                  </tr>
                );
              })}
              {!dcs?.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                    Koi Delivery Challan nahi hai abhi tak.
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
