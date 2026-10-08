"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDirectSalesOrderAction, type SalesOrderLineInput } from "@/app/actions/salesOrders";
import { QuotationLineEditor, blankLine, type EditableLine, type LineItem } from "@/components/QuotationLineEditor";
import { useItemCatalog } from "@/lib/useItemCatalog";
import { SearchablePicker, PARTY_SOURCE, ACTIVE_ONLY, type PickerOption } from "@/components/SearchablePicker";
import type { Tables } from "@/lib/supabase/database.types";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";

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

/**
 * For a client PO that arrived with no prior RFQ/Quotation (e.g. WhatsApp
 * or phone) — see fn_create_direct_sales_order, which generates the Query
 * + Quotation behind the scenes so the document trail stays complete.
 * Deliberately online-only: that generation is multi-table and has no
 * idempotent counterpart (unlike the normal quotation-linked flow), so
 * offline support isn't worth the risk of a half-created trail — the
 * normal flow still works fully offline as it already did.
 */
export function NewDirectSalesOrderForm({
  parties,
  items: itemsProp,
  units,
  defaultTaxPct,
}: {
  parties: Pick<Tables<"parties">, "id" | "legal_name">[];
  items: LineItem[];
  units: Tables<"units">[];
  defaultTaxPct: number;
}) {
  const { items, addItem } = useItemCatalog(itemsProp);
  const router = useRouter();
  const { isOnline } = useOfflineQueue();
  const partyOptions: PickerOption[] = parties.map((p) => ({ id: p.id, label: p.legal_name }));
  const [partyId, setPartyId] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([blankLine(defaultTaxPct, "init-0")]);
  const [clientPoNumber, setClientPoNumber] = useState("");
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [deliverySchedule, setDeliverySchedule] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [businessLine, setBusinessLine] = useState<"material_supply" | "fabrication">("material_supply");
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(confirmDuplicate: boolean) {
    setError(null);
    if (!partyId) {
      setError("Select a Client.");
      return;
    }
    if (!clientPoNumber.trim()) {
      setError("Client PO Number is required.");
      return;
    }
    if (!isOnline) {
      setError("You're offline — a Direct Sales Order needs to be online, since it also generates a Query and Quotation behind the scenes. Try again once you're back online.");
      return;
    }

    startTransition(async () => {
      const res = await createDirectSalesOrderAction({
        party_id: partyId,
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
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Client *</span>
          <SearchablePicker
            name="party_id"
            source={PARTY_SOURCE}
            filters={ACTIVE_ONLY}
            initialOptions={partyOptions}
            placeholder="Type a client name…"
            onChange={(o) => setPartyId(o?.id ?? "")}
          />
        </label>
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
            <textarea value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} rows={2} className="input resize-none" />
          </label>
        </div>
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Business Line *</span>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={businessLine === "material_supply"} onChange={() => setBusinessLine("material_supply")} />
              Material Supply
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={businessLine === "fabrication"} onChange={() => setBusinessLine("fabrication")} />
              Fabrication
            </label>
          </div>
        </div>
      </div>

      <QuotationLineEditor
        items={items}
        onItemPicked={addItem}
        units={units}
        lines={lines}
        onChange={setLines}
        defaultTaxPct={defaultTaxPct}
      />

      {duplicateWarning && (
        <div className="rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-warn space-y-2">
          <p>
            PO number <strong>{clientPoNumber}</strong> has already been used for this client. Different clients can use
            the same PO number — but the same client reusing this number may be a mistake.
          </p>
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={pending}
            className="rounded-md border border-warn bg-bg px-3 py-1.5 text-xs font-medium text-warn hover:bg-surface-2 transition"
          >
            Proceed Anyway
          </button>
        </div>
      )}

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — a Direct Sales Order needs to be online. Reconnect and try again.
        </p>
      )}

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="button"
        onClick={() => submit(false)}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Create Sales Order"}
      </button>
    </div>
  );
}
