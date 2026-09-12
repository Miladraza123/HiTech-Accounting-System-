import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { buttonClass } from "@/components/ui/Button";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

const TYPE_LABEL: Record<string, string> = { cash: "Cash in Hand", bank: "Bank", petty_cash: "Petty Cash" };

export default async function TransfersPage() {
  const user = await getCurrentUser();
  const canCreate = await hasPermission(user, "fund_transfer.manage");

  const supabase = await createClient();
  const { data: transfers } = await supabase
    .from("contra_transfers")
    .select("*, from_bank:bank_accounts!contra_transfers_from_bank_account_id_fkey(account_name), to_bank:bank_accounts!contra_transfers_to_bank_account_id_fkey(account_name), from_fund:petty_cash_funds!contra_transfers_from_petty_cash_fund_id_fkey(fund_name), to_fund:petty_cash_funds!contra_transfers_to_petty_cash_fund_id_fkey(fund_name)")
    .order("transfer_date", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Fund Transfers</h1>
          <p className="mt-1 text-sm text-ink-soft">Cash-to-Bank, Bank-to-Bank, Bank-to-Petty-Cash waghera — contra entries.</p>
        </div>
        {canCreate && (
          <Link href="/transfers/new" className={buttonClass()}>
            + New Transfer
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Transfer #</th>
                <th className="text-left px-4 py-2.5">From</th>
                <th className="text-left px-4 py-2.5">To</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {(transfers ?? []).map((t) => {
                const fromBank = t.from_bank as unknown as { account_name: string } | null;
                const toBank = t.to_bank as unknown as { account_name: string } | null;
                const fromFund = t.from_fund as unknown as { fund_name: string } | null;
                const toFund = t.to_fund as unknown as { fund_name: string } | null;
                return (
                  <tr key={t.id} className="border-t border-line hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/transfers/${t.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                        {t.transfer_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft text-xs">{fromBank?.account_name ?? fromFund?.fund_name ?? TYPE_LABEL[t.from_type]}</td>
                    <td className="px-4 py-2.5 text-ink-soft text-xs">{toBank?.account_name ?? toFund?.fund_name ?? TYPE_LABEL[t.to_type]}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink">{t.amount.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-ink-faint text-xs">{t.transfer_date}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[t.status] ?? ""}`}>{t.status}</span>
                    </td>
                  </tr>
                );
              })}
              {!transfers?.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                    Koi fund transfer nahi hua abhi tak.
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
