import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { toExclusiveUpperBound } from "@/lib/dashboardHelpers";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PaymentsTable } from "@/components/PaymentsTable";
import { CreditCard } from "lucide-react";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; direction?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  const canCreate = await hasPermission(user, "payment.manage");
  const { from, to, direction, page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  let query = supabase
    .from("payments")
    .select("*, parties(legal_name)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (from && to) query = query.gte("created_at", from).lt("created_at", toExclusiveUpperBound(to));
  if (direction === "receipt" || direction === "payment") query = query.eq("direction", direction);
  const { data: payments, count } = await query.range(rangeFrom, rangeTo);
  const totalPages = computeTotalPages(count ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Payments</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Bill-wise Payment &amp; Recovery — client receipts and supplier payments.
            {(from && to) || direction ? (
              <>
                {" "}
                — filtered{" "}
                <Link href="/payments" className="text-accent-ink underline underline-offset-2">
                  (view all)
                </Link>
              </>
            ) : null}
          </p>
        </div>
        {canCreate && (
          <div className="flex items-center gap-2">
            <Link href="/payments/new" className={buttonClass()}>
              + New Payment
            </Link>
            <Link href="/payments/new/batch" className={buttonClass("secondary")}>
              + Multiple Payments
            </Link>
          </div>
        )}
      </div>

      {payments?.length ? (
        <PaymentsTable
          payments={payments.map((p) => ({ ...p, parties: p.parties as unknown as { legal_name: string } | null }))}
          canManage={canCreate}
        />
      ) : (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <EmptyState
            icon={<CreditCard size={22} />}
            title="No Payments yet"
            description="Bill-wise Payment & Recovery — client receipts and supplier payments are recorded here."
            action={
              canCreate ? (
                <Link href="/payments/new" className={buttonClass()}>
                  + New Payment
                </Link>
              ) : undefined
            }
          />
        </div>
      )}

      <PaginationControls basePath="/payments" searchParams={{ from, to, direction }} currentPage={page} totalPages={totalPages} totalCount={count ?? 0} />
    </div>
  );
}
