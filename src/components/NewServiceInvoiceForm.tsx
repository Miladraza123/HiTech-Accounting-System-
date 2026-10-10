"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createServiceInvoiceAction, type ServiceInvoiceLineInput } from "@/app/actions/serviceJobs";
import { karachiToday } from "@/lib/karachiTime";

type Line = ServiceInvoiceLineInput & { key: number };

let keySeq = 0;
function blankLine(): Line {
  keySeq += 1;
  return { key: keySeq, description: "", qty: 1, rate: 0, tax_pct: 0 };
}

export function NewServiceInvoiceForm({ serviceJobId, requirePo = false }: { serviceJobId: string; requirePo?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(karachiToday());
  const [clientPo, setClientPo] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const taxTotal = lines.reduce((s, l) => s + ((Number(l.qty) || 0) * (Number(l.rate) || 0) * (Number(l.tax_pct) || 0)) / 100, 0);

  function update(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
        + Create Service Invoice
      </button>
    );
  }

  function submit() {
    setError(null);
    const validLines = lines.filter((l) => l.description.trim());
    if (requirePo && !clientPo.trim()) {
      setError("Client PO number is required for this client.");
      return;
    }
    if (!validLines.length) {
      setError("Add at least one line (e.g. Labor Charges).");
      return;
    }
    startTransition(async () => {
      const res = await createServiceInvoiceAction(
        serviceJobId,
        invoiceDate || null,
        validLines.map((l) => ({ description: l.description, qty: Number(l.qty) || 1, rate: Number(l.rate) || 0, tax_pct: Number(l.tax_pct) || 0 })),
        clientPo
      );
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap gap-3">
        <label className="block space-y-1 max-w-[10rem]">
          <span className="text-xs text-ink-faint">Invoice Date</span>
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="input !py-1 text-xs" />
        </label>
        <label className="block space-y-1 max-w-[14rem]">
          <span className="text-xs text-ink-faint">
            Client PO No. {requirePo && <span className="text-bad">*</span>}
          </span>
          <input value={clientPo} onChange={(e) => setClientPo(e.target.value)} placeholder="e.g. 4500101166" className="input !py-1 text-xs" />
        </label>
      </div>

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="text-left px-2 py-1.5">Description</th>
              <th className="text-right px-2 py-1.5 w-20">Qty</th>
              <th className="text-right px-2 py-1.5 w-28">Rate</th>
              <th className="text-right px-2 py-1.5 w-20">Tax %</th>
              <th className="text-right px-2 py-1.5 w-28">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-t border-line">
                <td className="px-1.5 py-1">
                  <textarea value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} rows={2} placeholder="e.g. Service at Chiller C/T # 02 (Enter for extra lines)" className="input !py-1 text-xs resize-y" />
                </td>
                <td className="px-1.5 py-1">
                  <input type="number" step="0.001" min="0.001" value={l.qty} onChange={(e) => update(l.key, { qty: Number(e.target.value) })} className="input !py-1 text-xs text-right tabular" />
                </td>
                <td className="px-1.5 py-1">
                  <input type="number" step="0.01" min="0" value={l.rate} onChange={(e) => update(l.key, { rate: Number(e.target.value) })} className="input !py-1 text-xs text-right tabular" />
                </td>
                <td className="px-1.5 py-1">
                  <input type="number" step="0.01" min="0" value={l.tax_pct} onChange={(e) => update(l.key, { tax_pct: Number(e.target.value) })} className="input !py-1 text-xs text-right tabular" />
                </td>
                <td className="px-2 py-1 text-right tabular text-ink whitespace-nowrap">{((Number(l.qty) || 0) * (Number(l.rate) || 0)).toFixed(2)}</td>
                <td className="px-1 text-center">
                  <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))} className="text-ink-faint hover:text-bad">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setLines((ls) => [...ls, blankLine()])} className="text-xs text-accent-ink underline underline-offset-2">
          + Add Line
        </button>
        <div className="text-xs text-ink-soft space-x-4 tabular">
          <span>Subtotal: {subtotal.toFixed(2)}</span>
          <span>Tax: {taxTotal.toFixed(2)}</span>
          <span className="font-semibold text-ink">Total: {(subtotal + taxTotal).toFixed(2)}</span>
        </div>
      </div>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line px-4 py-2 text-sm text-ink-soft hover:bg-surface-2 transition">
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60">
          {pending ? "Saving…" : "Create Service Invoice"}
        </button>
      </div>
    </div>
  );
}
