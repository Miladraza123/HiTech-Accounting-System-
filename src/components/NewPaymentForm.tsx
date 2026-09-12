"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPaymentAction, type PaymentAllocationInput } from "@/app/actions/payments";
import type { Tables } from "@/lib/supabase/database.types";

type OutstandingInvoice = { invoice_id: string; party_id: string; outstanding_amount: number; invoice_no: string; invoice_date: string };
type OutstandingBill = { supplier_bill_id: string; supplier_id: string; outstanding_amount: number; bill_no: string; bill_date: string };

export function NewPaymentForm({
  parties,
  defaultPartyId,
  defaultDirection,
  outstandingInvoices,
  outstandingBills,
  bankAccounts,
  pettyCashFunds,
}: {
  parties: Tables<"parties">[];
  defaultPartyId: string;
  defaultDirection: "receipt" | "payment";
  outstandingInvoices: OutstandingInvoice[];
  outstandingBills: OutstandingBill[];
  bankAccounts: Tables<"bank_accounts">[];
  pettyCashFunds: Tables<"petty_cash_funds">[];
}) {
  const router = useRouter();
  const [direction, setDirection] = useState<"receipt" | "payment">(defaultDirection);
  const [partyId, setPartyId] = useState(defaultPartyId);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("");
  const [source, setSource] = useState<"cash" | "bank" | "petty_cash">("cash");
  const [bankAccountId, setBankAccountId] = useState("");
  const [pettyCashFundId, setPettyCashFundId] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [allocAmounts, setAllocAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const eligibleParties = parties.filter((p) => (direction === "receipt" ? p.party_type !== "supplier" : p.party_type !== "client"));

  const rows = useMemo(() => {
    if (direction === "receipt") {
      return outstandingInvoices
        .filter((o) => o.party_id === partyId)
        .map((o) => ({ key: o.invoice_id, label: o.invoice_no, date: o.invoice_date, outstanding: o.outstanding_amount }));
    }
    return outstandingBills
      .filter((o) => o.supplier_id === partyId)
      .map((o) => ({ key: o.supplier_bill_id, label: o.bill_no, date: o.bill_date, outstanding: o.outstanding_amount }));
  }, [direction, partyId, outstandingInvoices, outstandingBills]);

  const allocTotal = rows.reduce((s, r) => s + (Number(allocAmounts[r.key]) || 0), 0);
  const amountNum = Number(amount) || 0;
  const unallocated = amountNum - allocTotal;

  function switchDirection(d: "receipt" | "payment") {
    setDirection(d);
    setPartyId("");
    setAllocAmounts({});
  }

  function submit() {
    setError(null);
    if (!partyId) {
      setError("Select Party.");
      return;
    }
    if (amountNum <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    if (allocTotal > amountNum) {
      setError("Allocation total cannot exceed the amount.");
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
    const allocations: PaymentAllocationInput[] = rows
      .map((r) => ({ key: r.key, amount: Number(allocAmounts[r.key]) || 0 }))
      .filter((r) => r.amount > 0)
      .map((r) => (direction === "receipt" ? { invoice_id: r.key, amount: r.amount } : { supplier_bill_id: r.key, amount: r.amount }));

    startTransition(async () => {
      const res = await createPaymentAction({
        party_id: partyId,
        direction,
        payment_date: paymentDate,
        method: method || null,
        reference_no: referenceNo || null,
        amount: amountNum,
        notes: notes || null,
        allocations,
        bank_account_id: source === "bank" ? bankAccountId : null,
        petty_cash_fund_id: source === "petty_cash" ? pettyCashFundId : null,
      });
      if (res.error) setError(res.error);
      else router.push(`/payments/${res.id}`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Direction *</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => switchDirection("receipt")}
              className={`rounded-md border px-3 py-2 text-sm text-left transition ${
                direction === "receipt" ? "border-accent bg-accent-soft/40 text-ink" : "border-line bg-bg text-ink-soft hover:bg-surface-2"
              }`}
            >
              <span className="block font-medium">Receipt — Money coming in from Client</span>
            </button>
            <button
              type="button"
              onClick={() => switchDirection("payment")}
              className={`rounded-md border px-3 py-2 text-sm text-left transition ${
                direction === "payment" ? "border-accent bg-accent-soft/40 text-ink" : "border-line bg-bg text-ink-soft hover:bg-surface-2"
              }`}
            >
              <span className="block font-medium">Payment — Money going out to Supplier</span>
            </button>
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">{direction === "receipt" ? "Client" : "Supplier"} *</span>
          <select value={partyId} onChange={(e) => { setPartyId(e.target.value); setAllocAmounts({}); }} className="input">
            <option value="">— Select —</option>
            {eligibleParties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.legal_name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Amount *</span>
            <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Date</span>
            <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="input" />
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Method / Note</span>
            <input value={method} onChange={(e) => setMethod(e.target.value)} className="input" placeholder="e.g. Cheque, Online Transfer" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Reference #</span>
            <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className="input" placeholder="Cheque # / transaction id" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Notes</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input" />
          </label>
        </div>
      </div>

      {partyId && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line">
            <h2 className="text-sm font-semibold text-ink">Bill-wise Allocation (optional)</h2>
            <p className="text-xs text-ink-faint mt-0.5">
              If you don&apos;t allocate, the amount will remain &quot;unallocated&quot; — as an on-account advance you can allocate it later.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="text-left px-3 py-2">{direction === "receipt" ? "Invoice #" : "Bill #"}</th>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-right px-3 py-2">Outstanding</th>
                  <th className="text-right px-3 py-2 w-32">Allocate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-xs text-ink">{r.label}</td>
                    <td className="px-3 py-2 text-ink-soft text-xs">{r.date}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{r.outstanding.toLocaleString()}</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={r.outstanding}
                        value={allocAmounts[r.key] ?? ""}
                        onChange={(e) => setAllocAmounts((a) => ({ ...a, [r.key]: e.target.value }))}
                        className="input !py-1 text-xs text-right tabular"
                        placeholder="0"
                      />
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 text-center text-ink-faint text-xs">
                      This party has no outstanding {direction === "receipt" ? "invoice" : "bill"}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-6 border-t border-line px-4 py-2.5 text-xs tabular">
            <span className="text-ink-soft">Allocated: {allocTotal.toLocaleString()}</span>
            <span className={unallocated < 0 ? "text-bad font-medium" : "text-ink-soft"}>Unallocated: {unallocated.toLocaleString()}</span>
          </div>
        </div>
      )}

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Record Payment"}
      </button>
    </div>
  );
}
