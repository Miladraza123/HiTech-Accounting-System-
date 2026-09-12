import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { CancelExpenseButton } from "@/components/CancelExpenseButton";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

const SETTLEMENT_STYLE: Record<string, string> = {
  Settled: "bg-good-soft text-good",
  Pending: "bg-warn-soft text-warn",
};

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canManage = await hasPermission(user, "expense.manage");

  const supabase = await createClient();
  const [{ data: expense }, { data: attachments }] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        "*, expense_heads(name, account_code), bank_accounts(account_name), petty_cash_funds(fund_name), jobs(job_no, description), profiles!expenses_responsible_user_id_fkey(full_name), vehicles(vehicle_no, make_model)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("attachments").select("*").eq("owner_table", "expenses").eq("owner_id", id).order("uploaded_at", { ascending: false }),
  ]);

  if (!expense) notFound();

  const head = expense.expense_heads as unknown as { name: string; account_code: string } | null;
  const bank = expense.bank_accounts as unknown as { account_name: string } | null;
  const fund = expense.petty_cash_funds as unknown as { fund_name: string } | null;
  const job = expense.jobs as unknown as { job_no: string; description: string } | null;
  const responsible = expense.profiles as unknown as { full_name: string } | null;
  const vehicle = expense.vehicles as unknown as { vehicle_no: string; make_model: string | null } | null;
  const canCancel = canManage && expense.status === "Posted";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/expenses" className="text-xs text-ink-faint hover:text-ink">
          ← Expenses
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-ink font-mono">{expense.expense_no}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[expense.status] ?? ""}`}>{expense.status}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${SETTLEMENT_STYLE[expense.settlement_status] ?? ""}`}>{expense.settlement_status}</span>
        </div>
        <p className="text-sm text-ink-soft mt-0.5">
          {head?.name} — {expense.expense_date}
        </p>
      </div>

      {expense.status === "Cancelled" && expense.cancel_reason && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">Cancellation reason: {expense.cancel_reason}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Amount</p>
              <p className="text-ink mt-0.5 tabular font-semibold">{expense.amount.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Paid From</p>
              <p className="text-ink mt-0.5">{bank?.account_name ?? fund?.fund_name ?? "Cash in Hand"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">GL Account</p>
              <p className="text-ink mt-0.5 font-mono text-xs">{head?.account_code}</p>
            </div>
            {job && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Job</p>
                <p className="text-ink mt-0.5">
                  <Link href={`/jobs`} className="text-accent-ink underline underline-offset-2">
                    {job.job_no}
                  </Link>
                </p>
              </div>
            )}
            {responsible && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Responsible</p>
                <p className="text-ink mt-0.5">{responsible.full_name}</p>
              </div>
            )}
            {expense.department && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Department</p>
                <p className="text-ink mt-0.5">{expense.department}</p>
              </div>
            )}
            {vehicle && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Vehicle</p>
                <p className="text-ink mt-0.5">
                  <Link href="/setup/vehicles" className="text-accent-ink underline underline-offset-2">
                    {vehicle.vehicle_no}
                  </Link>
                  {vehicle.make_model && <span className="text-ink-faint text-xs"> ({vehicle.make_model})</span>}
                </p>
              </div>
            )}
            {expense.odometer_reading !== null && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Meter Reading</p>
                <p className="text-ink mt-0.5 tabular">{expense.odometer_reading}</p>
              </div>
            )}
            {expense.fuel_litres !== null && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Fuel</p>
                <p className="text-ink mt-0.5 tabular">
                  {expense.fuel_litres} L @ {expense.fuel_rate}
                </p>
              </div>
            )}
          </div>
          {expense.description && <p className="text-sm text-ink-soft">{expense.description}</p>}

          <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink mb-1">Receipts / Attachments</h2>
            <AttachmentsPanel ownerTable="expenses" ownerId={id} revalidateTo={`/expenses/${id}`} attachments={attachments ?? []} canManage={canManage} />
          </div>
        </div>

        {canCancel && (
          <div className="space-y-6">
            <div className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink mb-2">Actions</h2>
              <CancelExpenseButton expenseId={id} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
