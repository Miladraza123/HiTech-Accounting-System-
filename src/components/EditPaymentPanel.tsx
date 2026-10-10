"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { amendPaymentAction } from "@/app/actions/payments";
import type { Tables } from "@/lib/supabase/database.types";
import { SearchablePicker, PARTY_SOURCE, type PickerFilter, type PickerOption } from "@/components/SearchablePicker";
import { karachiToday } from "@/lib/karachiTime";

const PARTY_FILTERS: Record<"receipt" | "payment", PickerFilter[]> = {
  receipt: [
    { column: "is_active", op: "eq", value: true },
    { column: "party_type", op: "in", value: ["client", "both"] },
  ],
  payment: [
    { column: "is_active", op: "eq", value: true },
    { column: "party_type", op: "in", value: ["supplier", "both"] },
  ],
};

type Source = "cash" | "bank" | "petty_cash";

/**
 * Owner-only Payment edit: Amount/Date/Party/Account/Reference. Direction
 * is fixed (never offered) — see fn_amend_payment's own scope decision.
 * When the Payment already has allocations, saving clears them all (the
 * full amount comes back fully unallocated) — this panel warns and
 * requires one extra confirm click before that happens, never silently.
 */
export function EditPaymentPanel({
  paymentId,
  direction,
  currentParty,
  currentAmount,
  currentDate,
  currentMethod,
  currentReferenceNo,
  currentSource,
  currentBankAccountId,
  currentPettyCashFundId,
  hasAllocations,
  bankAccounts,
  pettyCashFunds,
}: {
  paymentId: string;
  direction: "receipt" | "payment";
  currentParty: PickerOption;
  currentAmount: number;
  currentDate: string;
  currentMethod: string | null;
  currentReferenceNo: string | null;
  currentSource: Source;
  currentBankAccountId: string | null;
  currentPettyCashFundId: string | null;
  hasAllocations: boolean;
  bankAccounts: Tables<"bank_accounts">[];
  pettyCashFunds: Tables<"petty_cash_funds">[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [partyId, setPartyId] = useState(currentParty.id);
  const [amount, setAmount] = useState(String(currentAmount));
  const [date, setDate] = useState(currentDate || karachiToday());
  const [method, setMethod] = useState(currentMethod ?? "");
  const [referenceNo, setReferenceNo] = useState(currentReferenceNo ?? "");
  const [source, setSource] = useState<Source>(currentSource);
  const [bankAccountId, setBankAccountId] = useState(currentBankAccountId ?? "");
  const [pettyCashFundId, setPettyCashFundId] = useState(currentPettyCashFundId ?? "");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    const amountNum = Number(amount) || 0;
    if (!partyId) {
      setError("Select Party.");
      return;
    }
    if (amountNum <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    if (source === "bank" && !bankAccountId) {
      setError("Select Bank Account.");
      return;
    }
    if (source === "petty_cash" && !pettyCashFundId) {
      setError("Select Petty Cash Fund.");
      return;
    }
    if (hasAllocations && !confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      const res = await amendPaymentAction(paymentId, {
        party_id: partyId,
        payment_date: date,
        method: method || null,
        reference_no: referenceNo || null,
        amount: amountNum,
        bank_account_id: source === "bank" ? bankAccountId : null,
        petty_cash_fund_id: source === "petty_cash" ? pettyCashFundId : null,
      });
      if (res.error) {
        setError(res.error);
        setConfirming(false);
        return;
      }
      setOpen(false);
      setConfirming(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-line-strong bg-bg px-3 py-1.5 text-xs text-ink hover:bg-surface-2 transition"
      >
        Edit Payment
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-4">
      <h2 className="text-sm font-semibold text-ink">Edit Payment</h2>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">{direction === "receipt" ? "Client" : "Supplier"} *</span>
        <SearchablePicker
          name="party_id"
          source={PARTY_SOURCE}
          filters={PARTY_FILTERS[direction]}
          initialOptions={[currentParty]}
          initialSelected={currentParty}
          placeholder={direction === "receipt" ? "Type a client name…" : "Type a supplier name…"}
          onChange={(o) => setPartyId(o?.id ?? "")}
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Amount *</span>
          <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </label>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Cash/Bank Source *</span>
        <div className="flex gap-4 text-sm">
          {(["cash", "bank", "petty_cash"] as const).map((s) => (
            <label key={s} className="flex items-center gap-1.5">
              <input type="radio" checked={source === s} onChange={() => setSource(s)} />
              {s === "cash" ? "Cash in Hand" : s === "bank" ? "Bank" : "Petty Cash"}
            </label>
          ))}
        </div>
      </div>

      {source === "bank" && (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Bank Account *</span>
          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className="input">
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
          <select value={pettyCashFundId} onChange={(e) => setPettyCashFundId(e.target.value)} className="input">
            <option value="">— Select —</option>
            {pettyCashFunds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.fund_name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Method / Note</span>
          <input value={method} onChange={(e) => setMethod(e.target.value)} className="input" placeholder="e.g. Cheque, Online Transfer" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Reference #</span>
          <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className="input" placeholder="Cheque # / transaction id" />
        </label>
      </div>

      {confirming && (
        <div className="rounded-md bg-warn-soft border border-warn px-3 py-2.5 text-xs text-warn space-y-2">
          <p>
            This Payment already has an allocation against an Invoice/Supplier Bill. Saving will remove that
            allocation — the full amount will become unallocated, and you (or Accounts) can allocate it again
            afterward.
          </p>
        </div>
      )}

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-xs text-bad">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "Saving…" : confirming ? "Continue & Save" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConfirming(false);
            setError(null);
          }}
          disabled={pending}
          className="rounded-md border border-line-strong px-4 py-2 text-sm text-ink hover:bg-surface-2 transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
