"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvoiceAction, getAvailableInvoiceNumbersAction, type InvoiceLineInput, type InvoiceNumberOption } from "@/app/actions/invoices";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import { karachiToday } from "@/lib/karachiTime";

type SoLine = {
  id: string;
  description: string;
  delivered_qty: number;
  invoiced_qty: number;
  unit: string | null;
  rate: number;
  tax_pct: number;
  hs_code: string | null;
};
type SoOption = { id: string; so_no: string; business_line: string; parties: { legal_name: string } | null; lines: SoLine[] };

export function NewInvoiceForm({ salesOrders }: { salesOrders: SoOption[] }) {
  const router = useRouter();
  const [soId, setSoId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(karachiToday());
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Record<string, string>>({});
  const [taxPcts, setTaxPcts] = useState<Record<string, string>>({});
  // Pre-filled from the Item's own hs_code (see src/app/(app)/invoices/new/page.tsx),
  // always editable here — the Item master's value is only a starting point.
  const [hsCodes, setHsCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);
  const [numberOptions, setNumberOptions] = useState<InvoiceNumberOption[] | null>(null);
  const [invoiceNo, setInvoiceNo] = useState("");

  // The number choice only matters online (an offline-queued Invoice always
  // gets the plain next-sequential number once it syncs — see the offline
  // branch of submit() below) — no need to fetch it otherwise.
  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;
    getAvailableInvoiceNumbersAction().then((opts) => {
      if (cancelled) return;
      setNumberOptions(opts);
      const sequential = opts.find((o) => o.kind === "sequential");
      setInvoiceNo(sequential?.invoice_no ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [isOnline]);

  const so = salesOrders.find((s) => s.id === soId);

  function rateFor(l: SoLine) {
    return rates[l.id] ?? String(l.rate);
  }
  function taxPctFor(l: SoLine) {
    return taxPcts[l.id] ?? String(l.tax_pct);
  }
  function hsCodeFor(l: SoLine) {
    return hsCodes[l.id] ?? l.hs_code ?? "";
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
        hs_code: hsCodeFor(l).trim() || undefined,
      }))
      .filter((l) => l.qty > 0);
    if (!lines.length) {
      setError("Enter qty in at least one line.");
      return;
    }
    // Phase 4 (Master Offline-First Roadmap): re-validated against LIVE
    // delivered_qty/invoiced_qty at sync time (see this form's own RPC
    // entry in offlineQueue.ts) — never a stale offline snapshot.
    if (!isOnline) {
      startTransition(async () => {
        await enqueue({
          kind: "create",
          table: "invoices",
          recordId: crypto.randomUUID(),
          label: "Invoice",
          payload: { sales_order_id: soId, invoice_date: invoiceDate, lines },
        });
        setSavedOffline(true);
      });
      return;
    }

    startTransition(async () => {
      const res = await createInvoiceAction({ sales_order_id: soId, invoice_date: invoiceDate, lines, invoice_no: invoiceNo || undefined });
      if (res.error) setError(res.error);
      else router.push(`/invoices/${res.id}`);
    });
  }

  if (savedOffline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 max-w-xl space-y-3">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">
          Invoice saved on this device — it will get its Invoice number and sync automatically once you&apos;re back
          online.
        </p>
      </div>
    );
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

        {!!numberOptions?.some((o) => o.kind === "reclaimed") && (
          <div className="space-y-1.5 border-t border-line pt-3">
            <span className="text-xs font-medium text-ink-soft">
              Invoice Number — a cancelled Invoice&apos;s number is available to reuse
            </span>
            <div className="space-y-1.5">
              {numberOptions.map((o) => (
                <label key={o.invoice_no} className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={invoiceNo === o.invoice_no} onChange={() => setInvoiceNo(o.invoice_no)} />
                  <span className="font-mono">{o.invoice_no}</span>
                  <span className="text-xs text-ink-faint">{o.kind === "sequential" ? "(next number)" : "(reclaimed — cancelled Invoice)"}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {so && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="text-left px-3 py-2">Description</th>
                  <th className="text-left px-3 py-2 w-28 min-w-[7rem]">HS Code</th>
                  <th className="text-right px-3 py-2">Deliverable</th>
                  <th className="text-right px-3 py-2 w-28 min-w-[7rem]">Qty</th>
                  <th className="text-right px-3 py-2 w-28 min-w-[7rem]">Rate</th>
                  <th className="text-right px-3 py-2 w-20 min-w-[5rem]">Tax %</th>
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
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={hsCodeFor(l)}
                          onChange={(e) => setHsCodes((h2) => ({ ...h2, [l.id]: e.target.value }))}
                          placeholder="—"
                          className="input !py-1 text-xs"
                        />
                      </td>
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

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this Invoice will be saved on this device and synced automatically once you&apos;re
          back online.
        </p>
      )}

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : isOnline ? "Create Invoice" : "Save Offline"}
      </button>
    </div>
  );
}
