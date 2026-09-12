"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBankAccountAction } from "@/app/actions/cashBank";

export function NewBankAccountForm() {
  const router = useRouter();
  const [accountName, setAccountName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [branch, setBranch] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!accountName.trim()) {
      setError("Account name is required.");
      return;
    }
    startTransition(async () => {
      const res = await createBankAccountAction({
        account_name: accountName.trim(),
        bank_name: bankName.trim() || null,
        account_number: accountNumber.trim() || null,
        branch: branch.trim() || null,
        opening_balance: Number(openingBalance) || 0,
        opening_balance_date: openingDate,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setAccountName("");
      setBankName("");
      setAccountNumber("");
      setBranch("");
      setOpeningBalance("0");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Account Name *</span>
          <input value={accountName} onChange={(e) => setAccountName(e.target.value)} className="input" placeholder="e.g. Meezan Bank — Main Current A/C" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Bank Name</span>
          <input value={bankName} onChange={(e) => setBankName(e.target.value)} className="input" />
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Account Number</span>
          <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Branch</span>
          <input value={branch} onChange={(e) => setBranch(e.target.value)} className="input" />
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Opening Balance</span>
          <input type="number" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Opening Balance Date</span>
          <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} className="input" />
        </label>
      </div>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Create Bank Account"}
      </button>
    </div>
  );
}
