"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createContraEntryAction, type ContraSourceType } from "@/app/actions/cashBank";
import type { Tables } from "@/lib/supabase/database.types";

function SourcePicker({
  label,
  type,
  setType,
  bankId,
  setBankId,
  fundId,
  setFundId,
  bankAccounts,
  pettyCashFunds,
}: {
  label: string;
  type: ContraSourceType;
  setType: (t: ContraSourceType) => void;
  bankId: string;
  setBankId: (v: string) => void;
  fundId: string;
  setFundId: (v: string) => void;
  bankAccounts: Tables<"bank_accounts">[];
  pettyCashFunds: Tables<"petty_cash_funds">[];
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <div className="flex gap-3 text-sm">
        {(["cash", "bank", "petty_cash"] as const).map((t) => (
          <label key={t} className="flex items-center gap-1.5">
            <input type="radio" checked={type === t} onChange={() => setType(t)} />
            {t === "cash" ? "Cash in Hand" : t === "bank" ? "Bank" : "Petty Cash"}
          </label>
        ))}
      </div>
      {type === "bank" && (
        <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="input">
          <option value="">— Select Bank Account —</option>
          {bankAccounts.map((b) => (
            <option key={b.id} value={b.id}>
              {b.account_name}
            </option>
          ))}
        </select>
      )}
      {type === "petty_cash" && (
        <select value={fundId} onChange={(e) => setFundId(e.target.value)} className="input">
          <option value="">— Select Petty Cash Fund —</option>
          {pettyCashFunds.map((f) => (
            <option key={f.id} value={f.id}>
              {f.fund_name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function NewContraEntryForm({
  bankAccounts,
  pettyCashFunds,
}: {
  bankAccounts: Tables<"bank_accounts">[];
  pettyCashFunds: Tables<"petty_cash_funds">[];
}) {
  const router = useRouter();
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [fromType, setFromType] = useState<ContraSourceType>("cash");
  const [fromBankId, setFromBankId] = useState("");
  const [fromFundId, setFromFundId] = useState("");
  const [toType, setToType] = useState<ContraSourceType>("bank");
  const [toBankId, setToBankId] = useState("");
  const [toFundId, setToFundId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    if (fromType === "bank" && !fromBankId) {
      setError("Select Source Bank Account.");
      return;
    }
    if (fromType === "petty_cash" && !fromFundId) {
      setError("Select Source Petty Cash Fund.");
      return;
    }
    if (toType === "bank" && !toBankId) {
      setError("Select Destination Bank Account.");
      return;
    }
    if (toType === "petty_cash" && !toFundId) {
      setError("Select Destination Petty Cash Fund.");
      return;
    }
    startTransition(async () => {
      const res = await createContraEntryAction({
        transfer_date: transferDate,
        from_type: fromType,
        from_bank_account_id: fromType === "bank" ? fromBankId : null,
        from_petty_cash_fund_id: fromType === "petty_cash" ? fromFundId : null,
        to_type: toType,
        to_bank_account_id: toType === "bank" ? toBankId : null,
        to_petty_cash_fund_id: toType === "petty_cash" ? toFundId : null,
        amount: amt,
        notes: notes || null,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(`/transfers/${res.id}`);
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <label className="block space-y-1.5 max-w-xs">
        <span className="text-xs font-medium text-ink-soft">Transfer Date</span>
        <input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} className="input" />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SourcePicker
          label="From (Source) *"
          type={fromType}
          setType={setFromType}
          bankId={fromBankId}
          setBankId={setFromBankId}
          fundId={fromFundId}
          setFundId={setFromFundId}
          bankAccounts={bankAccounts}
          pettyCashFunds={pettyCashFunds}
        />
        <SourcePicker
          label="To (Destination) *"
          type={toType}
          setType={setToType}
          bankId={toBankId}
          setBankId={setToBankId}
          fundId={toFundId}
          setFundId={setToFundId}
          bankAccounts={bankAccounts}
          pettyCashFunds={pettyCashFunds}
        />
      </div>

      <label className="block space-y-1.5 max-w-xs">
        <span className="text-xs font-medium text-ink-soft">Amount *</span>
        <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input resize-none" />
      </label>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Transfer"}
      </button>
    </div>
  );
}
