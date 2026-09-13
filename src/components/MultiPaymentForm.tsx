"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPaymentsBatchAction, type BatchPaymentInput, type BatchPaymentResult } from "@/app/actions/payments";
import type { Tables } from "@/lib/supabase/database.types";
import { buttonClass } from "@/components/ui/Button";
import { Plus, Trash2 } from "lucide-react";

type Row = {
  key: string;
  direction: "receipt" | "payment";
  partyId: string;
  amount: string;
  paymentDate: string;
  source: string; // "cash" | `bank:<id>` | `petty:<id>`
  method: string;
  referenceNo: string;
  notes: string;
};

function newRow(direction: "receipt" | "payment"): Row {
  return {
    key: crypto.randomUUID(),
    direction,
    partyId: "",
    amount: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    source: "cash",
    method: "",
    referenceNo: "",
    notes: "",
  };
}

/**
 * Record several receipts/payments in one go — e.g. several customer
 * cheques collected the same day. Each row becomes its own payment
 * document (own payment number, own journal entry), posted atomically
 * as one batch: see fn_create_payments_batch. Bill-wise allocation isn't
 * available here — each row lands unallocated/"on account", same as a
 * single payment left unallocated; allocate it afterward from that
 * payment's own page.
 */
export function MultiPaymentForm({
  parties,
  bankAccounts,
  pettyCashFunds,
}: {
  parties: Tables<"parties">[];
  bankAccounts: Tables<"bank_accounts">[];
  pettyCashFunds: Tables<"petty_cash_funds">[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([newRow("receipt"), newRow("receipt")]);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BatchPaymentResult[] | null>(null);
  const [pending, startTransition] = useTransition();

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((rs) => [...rs, newRow(rs[rs.length - 1]?.direction ?? "receipt")]);
  }

  function removeRow(key: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  }

  function eligibleParties(direction: "receipt" | "payment") {
    return parties.filter((p) => (direction === "receipt" ? p.party_type !== "supplier" : p.party_type !== "client"));
  }

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  function submit() {
    setError(null);
    setResults(null);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const n = i + 1;
      if (!r.partyId) return setError(`Row ${n}: select a ${r.direction === "receipt" ? "client" : "supplier"}.`);
      if (!(Number(r.amount) > 0)) return setError(`Row ${n}: amount must be greater than zero.`);
      if (!r.source) return setError(`Row ${n}: select a cash/bank source.`);
    }

    const payments: BatchPaymentInput[] = rows.map((r) => ({
      party_id: r.partyId,
      direction: r.direction,
      payment_date: r.paymentDate,
      method: r.method.trim() || null,
      reference_no: r.referenceNo.trim() || null,
      amount: Number(r.amount) || 0,
      notes: r.notes.trim() || null,
      bank_account_id: r.source.startsWith("bank:") ? r.source.slice(5) : null,
      petty_cash_fund_id: r.source.startsWith("petty:") ? r.source.slice(6) : null,
    }));

    startTransition(async () => {
      const res = await createPaymentsBatchAction(payments);
      if (res.error) setError(res.error);
      else setResults(res.payments ?? []);
    });
  }

  if (results) {
    return (
      <div className="rounded-xl border border-good bg-good-soft p-5 space-y-3">
        <p className="text-sm font-semibold text-good">{results.length} payment{results.length === 1 ? "" : "s"} recorded.</p>
        <ul className="space-y-1 text-sm">
          {results.map((r) => (
            <li key={r.id}>
              <a href={`/payments/${r.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                {r.payment_no}
              </a>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-faint">
          Each one is unallocated for now — open it from its Payment # above to allocate it against an invoice/bill,
          or leave it as an on-account advance.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => router.push("/payments")} className={buttonClass("primary", "sm")}>
            Go to Payments
          </button>
          <button
            type="button"
            onClick={() => {
              setResults(null);
              setRows([newRow("receipt"), newRow("receipt")]);
            }}
            className={buttonClass("secondary", "sm")}
          >
            Record More
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-line">
          <p className="text-xs text-ink-faint">
            Each row is created as its own payment. Bill-wise allocation isn&apos;t available here — allocate a row
            afterward from its own Payment page, same as any unallocated payment.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2 w-32">Direction</th>
                <th className="text-left px-3 py-2 w-56 min-w-[14rem]">Party</th>
                <th className="text-right px-3 py-2 w-28 min-w-[7rem]">Amount</th>
                <th className="text-left px-3 py-2 w-36 min-w-[9rem]">Date</th>
                <th className="text-left px-3 py-2 w-48 min-w-[12rem]">Source</th>
                <th className="text-left px-3 py-2 w-32 min-w-[8rem]">Method</th>
                <th className="text-left px-3 py-2 w-32 min-w-[8rem]">Reference #</th>
                <th className="text-left px-3 py-2 w-40 min-w-[10rem]">Notes</th>
                <th className="px-2 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className="border-t border-line align-top">
                  <td className="px-2 py-1.5">
                    <select
                      value={r.direction}
                      onChange={(e) => updateRow(r.key, { direction: e.target.value as "receipt" | "payment", partyId: "" })}
                      className="input !py-1 text-xs"
                    >
                      <option value="receipt">Receipt (in)</option>
                      <option value="payment">Payment (out)</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={r.partyId} onChange={(e) => updateRow(r.key, { partyId: e.target.value })} className="input !py-1 text-xs">
                      <option value="">— Select —</option>
                      {eligibleParties(r.direction).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.legal_name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={r.amount}
                      onChange={(e) => updateRow(r.key, { amount: e.target.value })}
                      className="input !py-1 text-xs text-right tabular"
                      placeholder="0.00"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="date"
                      value={r.paymentDate}
                      onChange={(e) => updateRow(r.key, { paymentDate: e.target.value })}
                      className="input !py-1 text-xs"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={r.source} onChange={(e) => updateRow(r.key, { source: e.target.value })} className="input !py-1 text-xs">
                      <option value="cash">Cash in Hand</option>
                      {bankAccounts.length > 0 && (
                        <optgroup label="Bank">
                          {bankAccounts.map((b) => (
                            <option key={b.id} value={`bank:${b.id}`}>
                              {b.account_name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {pettyCashFunds.length > 0 && (
                        <optgroup label="Petty Cash">
                          {pettyCashFunds.map((f) => (
                            <option key={f.id} value={`petty:${f.id}`}>
                              {f.fund_name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input value={r.method} onChange={(e) => updateRow(r.key, { method: e.target.value })} className="input !py-1 text-xs" placeholder="Cheque, …" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      value={r.referenceNo}
                      onChange={(e) => updateRow(r.key, { referenceNo: e.target.value })}
                      className="input !py-1 text-xs"
                      placeholder="Cheque #"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input value={r.notes} onChange={(e) => updateRow(r.key, { notes: e.target.value })} className="input !py-1 text-xs" />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(r.key)}
                      disabled={rows.length === 1}
                      title={`Remove row ${i + 1}`}
                      className="text-ink-faint hover:text-bad transition disabled:opacity-30"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
          <button type="button" onClick={addRow} className={buttonClass("secondary", "sm", "gap-1.5")}>
            <Plus size={14} /> Add Row
          </button>
          <span className="text-xs tabular text-ink-soft">
            {rows.length} row{rows.length === 1 ? "" : "s"} · Total: <span className="font-medium text-ink">{total.toLocaleString()}</span>
          </span>
        </div>
      </div>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button type="button" onClick={submit} disabled={pending} className={buttonClass("primary", "md", "disabled:opacity-60")}>
        {pending ? "Saving…" : `Record ${rows.length} Payment${rows.length === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
