"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSalesOrderAction, type SalesOrderLineInput } from "@/app/actions/salesOrders";
import { QuotationLineEditor, blankLine, type EditableLine } from "@/components/QuotationLineEditor";
import type { Tables } from "@/lib/supabase/database.types";

function fromQuotationLines(lines: Tables<"quotation_lines">[], defaultTaxPct: number): EditableLine[] {
  if (!lines.length) return [blankLine(defaultTaxPct)];
  return lines.map((l, i) => ({
    key: `q${i}`,
    item_id: l.item_id ?? "",
    description: l.description,
    qty: String(l.qty),
    unit: l.unit ?? "",
    rate: String(l.rate),
    tax_pct: String(l.tax_pct),
  }));
}

function serialize(lines: EditableLine[]): SalesOrderLineInput[] {
  return lines
    .filter((l) => l.description.trim())
    .map((l) => ({
      item_id: l.item_id || undefined,
      description: l.description,
      ordered_qty: Number(l.qty) || 0,
      unit: l.unit || undefined,
      rate: Number(l.rate) || 0,
      tax_pct: Number(l.tax_pct) || 0,
    }));
}

export function NewSalesOrderForm({
  quotationId,
  quotationLines,
  items,
  units,
  defaultPaymentTerms,
  defaultTaxPct,
  creditWarning,
}: {
  quotationId: string;
  quotationLines: Tables<"quotation_lines">[];
  items: Tables<"items">[];
  units: Tables<"units">[];
  defaultPaymentTerms: string | null;
  defaultTaxPct: number;
  creditWarning?: string | null;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<EditableLine[]>(fromQuotationLines(quotationLines, defaultTaxPct));
  const [clientPoNumber, setClientPoNumber] = useState("");
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [deliverySchedule, setDeliverySchedule] = useState("");
  const [paymentTerms, setPaymentTerms] = useState(defaultPaymentTerms ?? "");
  const [businessLine, setBusinessLine] = useState<"material_supply" | "fabrication">("material_supply");
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(confirmDuplicate: boolean) {
    setError(null);
    if (!clientPoNumber.trim()) {
      setError("Client PO Number zaroori hai.");
      return;
    }
    startTransition(async () => {
      const res = await createSalesOrderAction({
        quotation_id: quotationId,
        client_po_number: clientPoNumber.trim(),
        po_date: poDate,
        delivery_schedule: deliverySchedule || null,
        payment_terms: paymentTerms || null,
        business_line: businessLine,
        lines: serialize(lines),
        confirm_duplicate: confirmDuplicate,
      });
      if (res.error === "DUPLICATE_PO") {
        setDuplicateWarning(true);
        return;
      }
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(`/sales-orders/${res.id}`);
    });
  }

  return (
    <div className="space-y-4">
      {creditWarning && (
        <div className="rounded-md border border-warn bg-warn-soft px-4 py-2.5 text-sm text-warn">
          ⚠ {creditWarning} — is se aage order continue kiya ja sakta hai, sirf aagahi ke liye hai.
        </div>
      )}
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Client PO Number *</span>
            <input
              value={clientPoNumber}
              onChange={(e) => {
                setClientPoNumber(e.target.value);
                setDuplicateWarning(false);
              }}
              className="input"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">PO Date</span>
            <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className="input" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Delivery Schedule</span>
            <input type="date" value={deliverySchedule} onChange={(e) => setDeliverySchedule(e.target.value)} className="input" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Payment Terms</span>
            <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className="input" />
          </label>
        </div>
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Business Line *</span>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={businessLine === "material_supply"}
                onChange={() => setBusinessLine("material_supply")}
              />
              Material Supply
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={businessLine === "fabrication"} onChange={() => setBusinessLine("fabrication")} />
              Fabrication
            </label>
          </div>
        </div>
      </div>

      <QuotationLineEditor items={items} units={units} lines={lines} onChange={setLines} defaultTaxPct={defaultTaxPct} />

      {duplicateWarning && (
        <div className="rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-warn space-y-2">
          <p>
            Is client ke liye PO number <strong>{clientPoNumber}</strong> pehle se istemal ho chuka hai. Alag clients same PO
            number use kar sakte hain — lekin ek hi client ka yeh number dobara aana ghalti ho sakti hai.
          </p>
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={pending}
            className="rounded-md border border-warn bg-bg px-3 py-1.5 text-xs font-medium text-warn hover:bg-surface-2 transition"
          >
            Phir bhi Proceed Karen
          </button>
        </div>
      )}

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="button"
        onClick={() => submit(false)}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Save ho raha hai…" : "Sales Order Banayen"}
      </button>
    </div>
  );
}
