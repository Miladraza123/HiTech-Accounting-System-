import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { CancelContraEntryButton } from "@/components/CancelContraEntryButton";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

const TYPE_LABEL: Record<string, string> = { cash: "Cash in Hand", bank: "Bank", petty_cash: "Petty Cash" };

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();

  const supabase = await createClient();
  const { data: t } = await supabase
    .from("contra_transfers")
    .select(
      "*, from_bank:bank_accounts!contra_transfers_from_bank_account_id_fkey(account_name), to_bank:bank_accounts!contra_transfers_to_bank_account_id_fkey(account_name), from_fund:petty_cash_funds!contra_transfers_from_petty_cash_fund_id_fkey(fund_name), to_fund:petty_cash_funds!contra_transfers_to_petty_cash_fund_id_fkey(fund_name)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!t) notFound();

  const fromBank = t.from_bank as unknown as { account_name: string } | null;
  const toBank = t.to_bank as unknown as { account_name: string } | null;
  const fromFund = t.from_fund as unknown as { fund_name: string } | null;
  const toFund = t.to_fund as unknown as { fund_name: string } | null;
  const canCancel = isOwner(user) && t.status === "Posted";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/transfers" className="text-xs text-ink-faint hover:text-ink">
          ← Fund Transfers
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-ink font-mono">{t.transfer_no}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[t.status] ?? ""}`}>{t.status}</span>
        </div>
        <p className="text-sm text-ink-soft mt-0.5">{t.transfer_date}</p>
      </div>

      {t.status === "Cancelled" && t.cancel_reason && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">Cancellation reason: {t.cancel_reason}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">From</p>
              <p className="text-ink mt-0.5">{fromBank?.account_name ?? fromFund?.fund_name ?? TYPE_LABEL[t.from_type]}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">To</p>
              <p className="text-ink mt-0.5">{toBank?.account_name ?? toFund?.fund_name ?? TYPE_LABEL[t.to_type]}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Amount</p>
              <p className="text-ink mt-0.5 tabular font-semibold">{t.amount.toLocaleString()}</p>
            </div>
          </div>
          {t.notes && <p className="text-sm text-ink-soft">{t.notes}</p>}
        </div>

        {canCancel && (
          <div className="space-y-6">
            <div className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink mb-2">Actions</h2>
              <CancelContraEntryButton transferId={id} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
