"use client";

export type PaymentSource = "cash" | "bank" | "petty_cash";

/** Cash in Hand / Bank / Petty Cash picker, same choices as Expenses. */
export function PaymentSourceFields({
  source,
  onSource,
  bankAccountId,
  onBankAccount,
  pettyCashFundId,
  onPettyCashFund,
  bankAccounts,
  pettyCashFunds,
}: {
  source: PaymentSource;
  onSource: (s: PaymentSource) => void;
  bankAccountId: string;
  onBankAccount: (id: string) => void;
  pettyCashFundId: string;
  onPettyCashFund: (id: string) => void;
  bankAccounts: { id: string; account_name: string }[];
  pettyCashFunds: { id: string; fund_name: string }[];
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Paid from *</span>
        <div className="flex flex-wrap gap-4 text-sm">
          {(["cash", "bank", "petty_cash"] as const).map((src) => (
            <label key={src} className="flex items-center gap-1.5">
              <input type="radio" checked={source === src} onChange={() => onSource(src)} />
              {src === "cash" ? "Cash in Hand" : src === "bank" ? "Bank" : "Petty Cash"}
            </label>
          ))}
        </div>
      </div>
      {source === "bank" && (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Bank Account *</span>
          <select value={bankAccountId} onChange={(e) => onBankAccount(e.target.value)} className="input">
            <option value="">— Select —</option>
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.account_name}
              </option>
            ))}
          </select>
        </label>
      )}
      {source === "petty_cash" && (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Petty Cash Fund *</span>
          <select value={pettyCashFundId} onChange={(e) => onPettyCashFund(e.target.value)} className="input">
            <option value="">— Select —</option>
            {pettyCashFunds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.fund_name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
