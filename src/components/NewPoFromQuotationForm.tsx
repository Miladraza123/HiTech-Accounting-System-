"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPoFromQuotationAction } from "@/app/actions/poFromQuotation";
import { asLineType, LINE_TYPE_LABELS, type LineType } from "@/lib/lineType";
import { poPlan } from "@/lib/poFromQuotation";
import { karachiToday } from "@/lib/karachiTime";

export type PoSourceLine = {
  id: string;
  item_id: string | null;
  description: string;
  qty: number;
  unit: string | null;
  rate: number;
  tax_pct: number;
  line_type: string | null;
  /** Already turned into a Sales Order / Service Job line by an earlier PO. */
  alreadyDone: boolean;
};

type Row = { id: string; include: boolean; line_type: LineType; qty: string; rate: string };

export function NewPoFromQuotationForm({
  quotationId,
  lines,
  defaultPaymentTerms,
  creditWarning,
}: {
  quotationId: string;
  lines: PoSourceLine[];
  defaultPaymentTerms: string | null;
  creditWarning?: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(
    lines.map((l) => ({ id: l.id, include: !l.alreadyDone, line_type: asLineType(l.line_type), qty: String(l.qty), rate: String(l.rate) }))
  );
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState(karachiToday());
  const [delivery, setDelivery] = useState("");
  const [terms, setTerms] = useState(defaultPaymentTerms ?? "");
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [pending, startTransition] = useTransition();

  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const plan = poPlan(rows);
  const parts = [
    plan.material ? `Material Supply Sales Order: ${plan.material} line(s)` : null,
    plan.fabrication ? `Fabrication Sales Order: ${plan.fabrication} line(s)` : null,
    plan.service ? `Service Job: ${plan.service} line(s)` : null,
  ].filter(Boolean) as string[];

  function submit(confirmDuplicate: boolean) {
    setError(null);
    if (!poNumber.trim()) return setError("Client PO Number is required.");
    const chosen = rows.filter((r) => r.include);
    if (!chosen.length) return setError("Choose at least one line.");
    for (const r of chosen) {
      if (!(Number(r.qty) > 0)) return setError("Quantity must be more than zero for every chosen line.");
      if (!(Number(r.rate) >= 0) || r.rate === "") return setError("Enter a rate for every chosen line.");
    }
    startTransition(async () => {
      const res = await createPoFromQuotationAction({
        quotation_id: quotationId,
        client_po_number: poNumber,
        po_date: poDate,
        delivery_schedule: delivery || null,
        payment_terms: terms || null,
        confirm_duplicate: confirmDuplicate,
        lines: chosen.map((r) => {
          const l = lines.find((x) => x.id === r.id)!;
          return {
            quotation_line_id: l.id,
            line_type: r.line_type,
            item_id: l.item_id ?? undefined,
            description: l.description,
            qty: Number(r.qty),
            unit: l.unit ?? undefined,
            rate: Number(r.rate),
            tax_pct: l.tax_pct,
          };
        }),
      });
      if (res.error === "DUPLICATE_PO") {
        setDuplicate(true);
        return;
      }
      if (res.error) return setError(res.error);
      router.push(`/quotations/${quotationId}`);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
      className="space-y-4"
    >
      {creditWarning && <p className="rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">{creditWarning}</p>}

      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Client PO Number *</span>
            <input value={poNumber} onChange={(e) => (setPoNumber(e.target.value), setDuplicate(false))} className="input" required />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">PO Date</span>
            <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className="input" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Delivery Schedule</span>
            <input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} className="input" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Payment Terms</span>
            <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} className="input resize-none" />
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-3 py-2 w-10" />
                <th className="text-left px-3 py-2 min-w-[14rem]">Description</th>
                <th className="text-left px-3 py-2 w-36 min-w-[9rem]">Type</th>
                <th className="text-right px-3 py-2 w-24 min-w-[6rem]">Qty</th>
                <th className="text-left px-3 py-2 w-20">Unit</th>
                <th className="text-right px-3 py-2 w-32 min-w-[8rem]">Rate</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const r = rows.find((x) => x.id === l.id)!;
                return (
                  <tr key={l.id} className={`border-t border-line align-top ${r.include ? "" : "opacity-60"}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={r.include} onChange={(e) => patch(l.id, { include: e.target.checked })} aria-label="Include this line" />
                    </td>
                    <td className="px-3 py-2 text-ink whitespace-pre-line">
                      {l.description}
                      {l.alreadyDone && <span className="block text-[11px] text-warn">Already in an earlier PO for this quotation</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={r.line_type} onChange={(e) => patch(l.id, { line_type: asLineType(e.target.value) })} className="input !py-1 text-xs" aria-label="Line type">
                        {(Object.keys(LINE_TYPE_LABELS) as LineType[]).map((t) => (
                          <option key={t} value={t}>
                            {LINE_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" step="0.001" min="0.001" value={r.qty} onChange={(e) => patch(l.id, { qty: e.target.value })} className="input !py-1 text-xs text-right tabular" />
                    </td>
                    <td className="px-3 py-2 text-ink-soft">{l.unit ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <input type="number" step="0.01" min="0" value={r.rate} onChange={(e) => patch(l.id, { rate: e.target.value })} className="input !py-1 text-xs text-right tabular" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 space-y-1">
        <p className="text-xs font-medium text-ink-soft">This PO will create</p>
        {parts.length ? (
          <ul className="text-sm text-ink list-disc list-inside">
            {parts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-faint">Choose at least one line.</p>
        )}
      </div>

      {duplicate && (
        <div className="rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-warn space-y-2">
          <p>
            PO number <strong>{poNumber}</strong> has already been used for this client. Different clients can use the same PO number, and a PO can be
            entered in parts, but the same client reusing this number may be a mistake.
          </p>
          <button type="button" onClick={() => submit(true)} disabled={pending} className="rounded-md border border-warn bg-bg px-3 py-1.5 text-xs font-medium text-warn hover:bg-surface-2 transition">
            Proceed Anyway
          </button>
        </div>
      )}
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button type="submit" disabled={pending || !parts.length} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? "Creating…" : "Confirm PO"}
      </button>
    </form>
  );
}
