"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cancelPaymentAction } from "@/app/actions/payments";
import { useBulkSelection } from "@/lib/useBulkSelection";
import { downloadCsv } from "@/lib/csvExport";
import { buttonClass } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const STATUS_TONE: Record<string, BadgeTone> = { Posted: "good", Cancelled: "bad" };
const DIRECTION_LABEL: Record<string, string> = { receipt: "Receipt (in)", payment: "Payment (out)" };

type PaymentRow = {
  id: string;
  payment_no: string;
  direction: string;
  amount: number;
  unallocated_amount: number;
  status: string;
  parties: { legal_name: string } | null;
};

/**
 * The Payments list table plus bulk select/actions — a client component
 * so checkbox state can live here, while the page itself stays a server
 * component doing the actual data fetch. "Cancel Selected" reuses the
 * exact same cancelPaymentAction a single cancel uses (same mandatory
 * reason, same server-side validation per row) — called once per
 * selected payment rather than as one new atomic batch RPC, since each
 * cancellation is an independent status transition: one row failing
 * (e.g. already cancelled by someone else) has no bearing on whether
 * the others are valid, so a partial-success report here is more
 * correct than an artificial all-or-nothing.
 */
export function PaymentsTable({ payments, canManage }: { payments: PaymentRow[]; canManage: boolean }) {
  const router = useRouter();
  const { selected, selectedRows, allSelected, toggle, toggleAll, clear } = useBulkSelection(payments);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cancellableSelected = selectedRows.filter((r) => r.status === "Posted");

  function exportSelected() {
    downloadCsv(
      `payments-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Payment #", "Party", "Direction", "Amount", "Unallocated", "Status"],
      selectedRows.map((p) => [p.payment_no, p.parties?.legal_name ?? "", DIRECTION_LABEL[p.direction] ?? p.direction, p.amount, p.unallocated_amount, p.status])
    );
  }

  function submitCancel() {
    setError(null);
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    startTransition(async () => {
      let okCount = 0;
      const failures: string[] = [];
      for (const p of cancellableSelected) {
        const res = await cancelPaymentAction(p.id, reason);
        if (res.error) failures.push(`${p.payment_no}: ${res.error}`);
        else okCount++;
      }
      setCancelling(false);
      setReason("");
      clear();
      setResult(`${okCount} cancelled${failures.length ? `, ${failures.length} failed` : ""}.`);
      if (failures.length) setError(failures.join(" · "));
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="rounded-xl border border-line bg-surface p-3 flex flex-wrap items-center gap-3">
          <span className="text-sm text-ink">{selected.size} selected</span>
          <button type="button" onClick={exportSelected} className={buttonClass("secondary", "sm")}>
            Export Selected (CSV)
          </button>
          {canManage && cancellableSelected.length > 0 && !cancelling && (
            <button type="button" onClick={() => setCancelling(true)} className={buttonClass("danger", "sm")}>
              Cancel Selected ({cancellableSelected.length})
            </button>
          )}
          <button type="button" onClick={clear} className="text-xs text-ink-faint underline underline-offset-2">
            Clear selection
          </button>
        </div>
      )}

      {cancelling && (
        <div className="rounded-xl border border-bad bg-bad-soft p-4 space-y-2">
          <p className="text-sm text-bad font-medium">
            Cancel {cancellableSelected.length} payment{cancellableSelected.length === 1 ? "" : "s"}? This reason is applied to all of them.
          </p>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason for cancelling…" className="input resize-none text-sm" />
          {error && <p className="text-xs text-bad">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setCancelling(false)} className={buttonClass("secondary", "sm")}>
              Back
            </button>
            <button type="button" onClick={submitCancel} disabled={pending} className={buttonClass("danger", "sm")}>
              {pending ? "Cancelling…" : "Confirm Cancel"}
            </button>
          </div>
        </div>
      )}

      {result && !cancelling && (
        <p className={`rounded-md px-3 py-2 text-sm ${error ? "bg-warn-soft text-warn" : "bg-good-soft text-good"}`}>
          {result} {error}
        </p>
      )}

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-2.5 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-3.5 w-3.5 accent-[var(--accent)]" aria-label="Select all" />
                </th>
                <th className="text-left px-4 py-2.5">Payment #</th>
                <th className="text-left px-4 py-2.5">Party</th>
                <th className="text-left px-4 py-2.5">Direction</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-right px-4 py-2.5">Unallocated</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-line even:bg-bg hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                      aria-label={`Select ${p.payment_no}`}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/payments/${p.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                      {p.payment_no}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft text-xs whitespace-nowrap">{p.parties?.legal_name}</td>
                  <td className="px-4 py-2.5 text-ink-soft text-xs">{DIRECTION_LABEL[p.direction]}</td>
                  <td className="px-4 py-2.5 text-right tabular text-ink">{p.amount.toLocaleString()}</td>
                  <td className={`px-4 py-2.5 text-right tabular ${p.unallocated_amount > 0 ? "text-warn font-medium" : "text-ink-soft"}`}>
                    {p.unallocated_amount.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>{p.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
