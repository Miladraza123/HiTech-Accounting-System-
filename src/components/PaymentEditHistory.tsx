"use client";

import { useState, useTransition } from "react";
import { getPaymentAmendmentHistoryAction, type PaymentAmendmentRow } from "@/app/actions/payments";

const FIELD_LABEL: Record<string, string> = {
  party_id: "Party",
  payment_date: "Date",
  method: "Method",
  reference_no: "Reference #",
  amount: "Amount",
  bank_account_id: "Bank Account",
  petty_cash_fund_id: "Petty Cash Fund",
};

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

/**
 * Owner-only, collapsed by default — kept out of the ledger/every report
 * entirely (fn_amend_payment updates the ledger in place with no visible
 * reversal), but not lost: every edit's before/after values live here.
 */
export function PaymentEditHistory({ paymentId }: { paymentId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PaymentAmendmentRow[] | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (!open && rows === null) {
      startTransition(async () => {
        setRows(await getPaymentAmendmentHistoryAction(paymentId));
      });
    }
    setOpen((o) => !o);
  }

  return (
    <details open={open} className="rounded-md border border-line px-3 py-2 text-xs">
      <summary className="cursor-pointer text-ink-soft" onClick={(e) => { e.preventDefault(); toggle(); }}>
        Edit History
      </summary>
      <div className="mt-2 space-y-2">
        {pending && <p className="text-ink-faint">Loading…</p>}
        {!pending && rows?.length === 0 && <p className="text-ink-faint">No edits yet.</p>}
        {!pending &&
          rows?.map((r) => (
            <div key={r.id} className="rounded-md border border-line bg-bg px-2.5 py-2 space-y-1">
              <p className="text-ink-faint">{new Date(r.amended_at).toLocaleString("en-PK")}</p>
              {Object.keys(r.new_values)
                .filter((k) => fmt(r.old_values[k]) !== fmt(r.new_values[k]))
                .map((k) => (
                  <p key={k} className="text-ink">
                    {FIELD_LABEL[k] ?? k}: <span className="text-ink-faint">{fmt(r.old_values[k])}</span> →{" "}
                    {fmt(r.new_values[k])}
                  </p>
                ))}
              {r.reason && <p className="text-ink-faint italic">{r.reason}</p>}
            </div>
          ))}
      </div>
    </details>
  );
}
