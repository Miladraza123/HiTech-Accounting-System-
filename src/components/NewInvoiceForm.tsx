"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvoiceAction, type InvoiceLineInput } from "@/app/actions/invoices";

type SoLine = {
  id: string;
  description: string;
  delivered_qty: number;
  invoiced_qty: number;
  unit: string | null;
  rate: number;
  tax_pct: number;
};
type SoOption = { id: string; so_no: string; business_line: string; parties: { legal_name: string } | null; lines: SoLine[] };

export function NewInvoiceForm({ salesOrders }: { salesOrders: SoOption[] }) {
  const router = useRouter();
  const [soId, setSoId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Record<string, string>>({});
  const [taxPcts, setTaxPcts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const so = salesOrders.find((s) => s.id === soId);

  function rateFor(l: SoLine) {
    return rates[l.id] ?? String(l.rate);
  }
  function taxPctFor(l: SoLine) {
    return taxPcts[l.id] ?? String(l.tax_pct);
  }

  const subtotal = (so?.lines ?? []).reduce((s, l) => {
    const q = Number(qtys[l.id] ?? 0);
    const r = Number(rateFor(l));
    return s + q * r;
  }, 0);
  const taxTotal = (so?.lines ?? []).reduce((s, l) => {
    const q = Number(qtys[l.id] ?? 0);
    const r = Number(rateFor(l));
    const t = Number(taxPctFor(l));
    return s + (q * r * t) / 100;
  }, 0);

  function submit() {
    setError(null);
    if (!soId) {
      setError("Select Sales Order.");
      return;
    }
    const lines: InvoiceLineInput[] = (so?.lines ?? [])
      .map((l) => ({
        sales_order_line_id: l.id,
        qty: Number(qtys[l.id] ?? 0),
        rate: Number(rateFor(l)),
        tax_pct: Number(taxPctFor(l)),
      }))
      .filter((l) => l.qty > 0);
    if (!lines.length) {
      setError("Enter qty in at least one line.");
      return;
    }
    startTransition(async () => {
      const res = await createInvoiceAction({ sales_order_id: soId, invoice_date: invoiceDate, lines });
      if (res.error) setError(res.error);
      else router.push(`/invoices/${res.id}`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Sales Order *</span>
            <select value={soId} onChange={(e) => setSoId(e.target.value)} className="input">
              <option value="">— Select —</option>
              {salesOrders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.so_no} — {s.parties?.legal_name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Invoice Date</span>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="input" />
          </label>
        </div>
      </div>

      {so && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="text-left px-3 py-2">Description</th>
                  <th className="text-right px-3 py-2">Deliverable</th>
                  <th className="text-right px-3 py-2 w-28">Qty</th>
                  <th className="text-right px-3 py-2 w-28">Rate</th>
                  <th className="text-right px-3 py-2 w-20">Tax %</th>
                  <th className="text-right px-3 py-2 w-28">Amount</th>
                </tr>
              </thead>
              <tbody>
                {so.lines.map((l) => {
                  const pending = l.delivered_qty - l.invoiced_qty;
                  const q = Number(qtys[l.id] ?? 0);
                  const r = Number(rateFor(l));
                  return (
                    <tr key={l.id} className="border-t border-line">
                      <td className="px-3 py-2 text-ink">{l.description}</td>
                      <td className="px-3 py-2 text-right tabular text-ink-soft">
                        {pending.toFixed(3)} {l.unit}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          max={pending}
                          value={qtys[l.id] ?? ""}
                          onChange={(e) => setQtys((q2) => ({ ...q2, [l.id]: e.target.value }))}
                          className="input !py-1 text-xs text-right tabular"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={rateFor(l)}
                          onChange={(e) => setRates((r2) => ({ ...r2, [l.id]: e.target.value }))}
                          className="input !py-1 text-xs text-right tabular"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={taxPctFor(l)}
                          onChange={(e) => setTaxPcts((t2) => ({ ...t2, [l.id]: e.target.value }))}
                          className="input !py-1 text-xs text-right tabular"
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular text-ink whitespace-nowrap">{(q * r).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-6 border-t border-line px-3 py-2 text-xs text-ink-soft tabular">
            <span>Subtotal: {subtotal.toFixed(2)}</span>
            <span>Tax: {taxTotal.toFixed(2)}</span>
            <span className="font-semibold text-ink">Total: {(subtotal + taxTotal).toFixed(2)}</span>
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
        {pending ? "Saving…" : "Create Invoice"}
      </button>
    </div>
  );
}
