"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAdvanceAction } from "@/app/actions/hr";
import { karachiToday } from "@/lib/karachiTime";
import { PaymentSourceFields, type PaymentSource } from "@/components/PaymentSourceFields";

export function NewAdvanceForm({
  employees,
  bankAccounts,
  pettyCashFunds,
  journalOn,
}: {
  employees: { id: string; code: string; full_name: string }[];
  bankAccounts: { id: string; account_name: string }[];
  pettyCashFunds: { id: string; fund_name: string }[];
  journalOn: boolean;
}) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(karachiToday());
  const [amount, setAmount] = useState("");
  const [installment, setInstallment] = useState("");
  const [source, setSource] = useState<PaymentSource>("cash");
  const [bankId, setBankId] = useState("");
  const [pettyId, setPettyId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const amt = Number(amount);
    const inst = Number(installment || amount);
    if (!employeeId) return setError("Pick an employee.");
    if (!(amt > 0)) return setError("Amount must be more than 0.");
    if (!(inst > 0) || inst > amt) return setError("Recovery per salary must be more than 0 and not more than the advance.");
    startTransition(async () => {
      const res = await createAdvanceAction({
        employee_id: employeeId,
        advance_date: date,
        amount: amt,
        installment: inst,
        payment_source: source,
        bank_account_id: source === "bank" ? bankId || null : null,
        petty_cash_fund_id: source === "petty_cash" ? pettyId || null : null,
        note,
      });
      if (res.error) return setError(res.error);
      setEmployeeId("");
      setAmount("");
      setInstallment("");
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 sm:p-5 space-y-4">
      <h2 className="text-sm font-semibold text-ink">Give Advance / Loan</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Employee *</span>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="input">
            <option value="">— Select —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} ({e.code})
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Date *</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Amount (Rs) *</span>
          <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Take back per salary (Rs)</span>
          <input type="number" min="0.01" step="0.01" value={installment} onChange={(e) => setInstallment(e.target.value)} placeholder="Whole amount" className="input" />
        </label>
      </div>
      <PaymentSourceFields
        source={source}
        onSource={setSource}
        bankAccountId={bankId}
        onBankAccount={setBankId}
        pettyCashFundId={pettyId}
        onPettyCashFund={setPettyId}
        bankAccounts={bankAccounts}
        pettyCashFunds={pettyCashFunds}
      />
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
      </label>
      <p className="text-xs text-ink-faint">
        {journalOn
          ? "Salary journal is ON: this posts Employee Advances (debit) against the account chosen above."
          : "Salary journal is OFF: the advance is only recorded here; nothing is posted to the ledger."}{" "}
        The salary sheet suggests taking back the per-salary amount until it is cleared; it can be changed on each sheet.
      </p>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save Advance"}
      </button>
    </div>
  );
}
