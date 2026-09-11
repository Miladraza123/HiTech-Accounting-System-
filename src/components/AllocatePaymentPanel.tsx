"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { allocatePaymentAction, type PaymentAllocationInput } from "@/app/actions/payments";

type Row = { key: string; label: string; date: string; outstanding: number };

export function AllocatePaymentPanel({
  paymentId,
  direction,
  unallocatedAmount,
  rows,
}: {
  paymentId: string;
  direction: "receipt" | "payment";
  unallocatedAmount: number;
  rows: Row[];
}) {
  const router = useRouter();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = rows.reduce((s, r) => s + (Number(amounts[r.key]) || 0), 0);

  function submit() {
    setError(null);
    if (total <= 0) {
      setError("Kam az kam ek line mein amount likhen.");
      return;
    }
    if (total > unallocatedAmount) {
      setError("Total unallocated amount se zyada nahi ho sakta.");
      return;
    }
    const allocations: PaymentAllocationInput[] = rows
      .map((r) => ({ key: r.key, amount: Number(amounts[r.key]) || 0 }))
      .filter((r) => r.amount > 0)
      .map((r) => (direction === "receipt" ? { invoice_id: r.key, amount: r.amount } : { supplier_bill_id: r.key, amount: r.amount }));

    startTransition(async () => {
      const res = await allocatePaymentAction(paymentId, allocations);
      if (res.error) setError(res.error);
      else {
        setAmounts({});
        router.refresh();
      }
    });
  }

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink mb-1">Unallocated Amount Allocate Karen</h2>
        <p className="text-xs text-ink-faint">Is party ka koi outstanding {direction === "receipt" ? "invoice" : "bill"} nahi hai abhi.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line">
        <h2 className="text-sm font-semibold text-ink">Unallocated Amount Allocate Karen</h2>
        <p className="text-xs text-ink-faint mt-0.5">Unallocated: {unallocatedAmount.toLocaleString()}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="text-left px-3 py-2">{direction === "receipt" ? "Invoice #" : "Bill #"}</th>
              <th className="text-right px-3 py-2">Outstanding</th>
              <th className="text-right px-3 py-2 w-32">Allocate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-line">
                <td className="px-3 py-2 font-mono text-xs text-ink">{r.label}</td>
                <td className="px-3 py-2 text-right tabular text-ink-soft">{r.outstanding.toLocaleString()}</td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={r.outstanding}
                    value={amounts[r.key] ?? ""}
                    onChange={(e) => setAmounts((a) => ({ ...a, [r.key]: e.target.value }))}
                    className="input !py-1 text-xs text-right tabular"
                    placeholder="0"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="px-4 py-2 text-xs text-bad">{error}</p>}
      <div className="border-t border-line p-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="w-full rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "…" : "Allocate Karen"}
        </button>
      </div>
    </div>
  );
}
