import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";
import { buttonClass } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Package } from "lucide-react";

const STATUS_TONE: Record<string, BadgeTone> = {
  Issued: "ledger",
  Cancelled: "bad",
};

const ACCEPTANCE_TONE: Record<string, BadgeTone> = {
  Pending: "warn",
  Accepted: "good",
  Disputed: "bad",
};

export default async function DeliveryChallansPage({
  searchParams,
}: {
  searchParams: Promise<{ acceptance?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  const canCreate = await hasPermission(user, "delivery_challan.manage");
  const { acceptance, page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  let query = supabase
    .from("delivery_challans")
    .select("*, parties(legal_name), sales_orders(so_no)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (acceptance) query = query.eq("acceptance_status", acceptance);
  const { data: dcs, count } = await query.range(rangeFrom, rangeTo);
  const totalPages = computeTotalPages(count ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Delivery Challans</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Dispatch aur Client Acceptance / POD.
            {acceptance && (
              <>
                {" "}
                — filtered{" "}
                <Link href="/delivery-challans" className="text-accent-ink underline underline-offset-2">
                  (sab dekhen)
                </Link>
              </>
            )}
          </p>
        </div>
        {canCreate && (
          <Link href="/delivery-challans/new" className={buttonClass()}>
            + New Delivery Challan
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        {dcs?.length ? (
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
                {dcs.map((dc) => {
                  const party = dc.parties as unknown as { legal_name: string } | null;
                  const so = dc.sales_orders as unknown as { so_no: string } | null;
                  return (
                    <tr key={dc.id} className="border-t border-line even:bg-bg hover:bg-surface-2">
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
                        <Badge tone={STATUS_TONE[dc.status] ?? "neutral"}>{dc.status}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={ACCEPTANCE_TONE[dc.acceptance_status] ?? "neutral"}>{dc.acceptance_status}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Package size={22} />}
            title="Koi Delivery Challan nahi hai abhi tak"
            description="Dispatch aur Client Acceptance / POD yahan record hote hain."
            action={
              canCreate ? (
                <Link href="/delivery-challans/new" className={buttonClass()}>
                  + New Delivery Challan
                </Link>
              ) : undefined
            }
          />
        )}
      </div>

      <PaginationControls basePath="/delivery-challans" searchParams={{ acceptance }} currentPage={page} totalPages={totalPages} totalCount={count ?? 0} />
    </div>
  );
}
