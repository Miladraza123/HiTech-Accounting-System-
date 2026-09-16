"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createJobAction, type MaterialLineInput } from "@/app/actions/jobs";
import { MaterialLineEditor, blankMaterialLine, type EditableMaterialLine , type LineItem} from "@/components/MaterialLineEditor";
import { useItemCatalog } from "@/lib/useItemCatalog";
import type { Tables } from "@/lib/supabase/database.types";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";

type SoLineOption = {
  id: string;
  description: string;
  ordered_qty: number;
  unit: string | null;
  sales_orders: { so_no: string; client_po_number: string; parties: { legal_name: string } | null };
};

type AltUnit = { item_id: string; unit: string; factor: number; is_active: boolean };

// Material requirement qty must always end up base_unit-denominated — stock reservation
// pooling (fn_reserve_job_material etc.) compares required_qty against stock_availability,
// which is tracked in base_unit. Converts here at entry, not at the SQL layer.
function serialize(lines: EditableMaterialLine[], items: LineItem[], altUnits: AltUnit[]): { result: MaterialLineInput[] | null; error: string | null } {
  const result: MaterialLineInput[] = [];
  const anyFilled = lines.some((l) => l.item_id);
  for (const l of lines) {
    if (!l.item_id) {
      // The item is picked through a hidden input now, which native form
      // validation does not cover (the <select> it replaced was `required`).
      // Once any line is filled in, a line left without an item is a
      // mistake — report it rather than silently dropping a material the
      // user believes they entered. Before that, fall through so the
      // caller's own "nothing entered yet" message is the one shown.
      if (anyFilled) {
        return { result: null, error: "Every material line needs an item — pick one, or remove the line." };
      }
      continue;
    }
    const item = items.find((i) => i.id === l.item_id);
    const qtyEntered = Number(l.qty) || 0;
    let baseQty = qtyEntered;
    if (item && l.unit && l.unit !== item.base_unit) {
      const alt = altUnits.find((a) => a.item_id === item.id && a.unit === l.unit && a.is_active);
      if (!alt) {
        return {
          result: null,
          error: `No conversion factor is set from "${item.item_code}"'s unit (${l.unit}) to the base unit (${item.base_unit}) — add "Alternate Units" in the Item Master.`,
        };
      }
      baseQty = Math.round(qtyEntered * alt.factor * 1000) / 1000;
    }
    result.push({ item_id: l.item_id, required_qty: baseQty, unit: item?.base_unit ?? (l.unit || undefined) });
  }
  return { result, error: null };
}

export function NewJobForm({
  soLines,
  warehouses,
  templates,
  items: itemsProp,
  units,
  altUnits,
  profiles,
}: {
  soLines: SoLineOption[];
  warehouses: Tables<"warehouses">[];
  templates: Tables<"product_templates">[];
  // A first page of items plus those already referenced here — the rest
  // are found by typing, searched in the database. See SearchablePicker.
  items: LineItem[];
  units: Tables<"units">[];
  altUnits: AltUnit[];
  profiles: Tables<"profiles">[];
}) {
  // The form works from this list, not the raw prop: every item picked by
  // searching is merged in, so the lookups below keep resolving. See
  // useItemCatalog.
  const { items, addItem } = useItemCatalog(itemsProp);
  const router = useRouter();
  const altUnitsByItem: Record<string, { unit: string; factor: number }[]> = {};
  for (const a of altUnits) {
    if (!a.is_active) continue;
    (altUnitsByItem[a.item_id] ??= []).push({ unit: a.unit, factor: a.factor });
  }
  const [soLineId, setSoLineId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [description, setDescription] = useState("");
  const [jobQty, setJobQty] = useState("1");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [requiredDeliveryDate, setRequiredDeliveryDate] = useState("");
  const [lines, setLines] = useState<EditableMaterialLine[]>([blankMaterialLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);

  const selectedSoLine = soLines.find((l) => l.id === soLineId);
  const selectedTemplate = templates.find((t) => t.id === templateId);

  function pickSoLine(id: string) {
    setSoLineId(id);
    const l = soLines.find((sl) => sl.id === id);
    if (l && !description) setDescription(l.description);
  }

  function submit() {
    setError(null);
    if (!soLineId) {
      setError("Select Sales Order line.");
      return;
    }
    if (!warehouseId) {
      setError("Select Warehouse.");
      return;
    }
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }
    const qty = Number(jobQty);
    if (!qty || qty <= 0) {
      setError("Job qty must be greater than zero.");
      return;
    }
    let materialLines: MaterialLineInput[] = [];
    if (!templateId) {
      const { result, error: convErr } = serialize(lines, items, altUnits);
      if (convErr) {
        setError(convErr);
        return;
      }
      materialLines = result ?? [];
      if (!materialLines.length) {
        setError("Select a Template or enter the material requirement manually.");
        return;
      }
    }

    // Phase 7 (Master Offline-First Roadmap): also auto-reserves free
    // stock atomically, exactly like the online path (see this form's own
    // RPC entry in offlineQueue.ts) — re-validated against LIVE free stock
    // at sync time, never a stale offline snapshot.
    if (!isOnline) {
      startTransition(async () => {
        await enqueue({
          kind: "create",
          table: "jobs",
          recordId: crypto.randomUUID(),
          label: "Job",
          payload: {
            sales_order_line_id: soLineId,
            warehouse_id: warehouseId,
            product_template_id: templateId || null,
            description,
            job_qty: qty,
            responsible_user_id: responsibleUserId || null,
            start_date: startDate || null,
            required_delivery_date: requiredDeliveryDate || null,
            material_lines: materialLines,
          },
        });
        setSavedOffline(true);
      });
      return;
    }

    startTransition(async () => {
      const res = await createJobAction({
        sales_order_line_id: soLineId,
        warehouse_id: warehouseId,
        product_template_id: templateId || null,
        description,
        job_qty: qty,
        responsible_user_id: responsibleUserId || null,
        start_date: startDate || null,
        required_delivery_date: requiredDeliveryDate || null,
        material_lines: materialLines,
      });
      if (res.error) setError(res.error);
      else router.push(`/jobs/${res.id}`);
    });
  }

  const templatePreview = useMemo(() => {
    if (!selectedTemplate) return null;
    const qty = Number(jobQty) || 0;
    return { qty };
  }, [selectedTemplate, jobQty]);

  if (savedOffline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 max-w-xl space-y-3">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">
          Job saved on this device — it will get its Job number and sync automatically once you&apos;re back online.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Fabrication Sales Order Line *</span>
          <select value={soLineId} onChange={(e) => pickSoLine(e.target.value)} className="input">
            <option value="">— Select —</option>
            {soLines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.sales_orders.so_no} — {l.sales_orders.parties?.legal_name} — {l.description} ({l.ordered_qty} {l.unit})
              </option>
            ))}
          </select>
          {selectedSoLine && (
            <p className="text-xs text-ink-faint">
              Client PO: {selectedSoLine.sales_orders.client_po_number} · Ordered: {selectedSoLine.ordered_qty} {selectedSoLine.unit}
            </p>
          )}
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Warehouse (material issue/reserve) *</span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input">
              <option value="">— Select —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Job Qty *</span>
            <input type="number" step="0.001" min="0.001" value={jobQty} onChange={(e) => setJobQty(e.target.value)} className="input" />
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Job Description *</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input resize-none" />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Responsible Person</span>
            <select value={responsibleUserId} onChange={(e) => setResponsibleUserId(e.target.value)} className="input">
              <option value="">— None —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Start Date</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Required Delivery Date</span>
            <input type="date" value={requiredDeliveryDate} onChange={(e) => setRequiredDeliveryDate(e.target.value)} className="input" />
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5 space-y-3">
        <span className="text-xs font-medium text-ink-soft">Is the product a repeat (template) or custom?</span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setTemplateId("")}
            className={`rounded-md border px-3 py-2 text-sm text-left transition ${
              !templateId ? "border-accent bg-accent-soft/40 text-ink" : "border-line bg-bg text-ink-soft hover:bg-surface-2"
            }`}
          >
            <span className="block font-medium">Custom</span>
            <span className="block text-xs text-ink-faint">Enter material requirement manually</span>
          </button>
          <div className="space-y-1.5">
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className={`input !py-2 ${templateId ? "border-accent" : ""}`}
              disabled={!templates.length}
            >
              <option value="">— Repeat product template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.template_code} — {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {templateId && templatePreview ? (
          <p className="text-xs text-ink-soft">
            Material requirement will be calculated automatically from the template: <span className="tabular">qty_per_unit × {templatePreview.qty}</span>.
          </p>
        ) : (
          <MaterialLineEditor items={items} onItemPicked={addItem} units={units} lines={lines} onChange={setLines} qtyLabel="Required Qty" altUnitsByItem={altUnitsByItem} />
        )}
      </div>

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this Job will be saved on this device and synced automatically once you&apos;re
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
        {pending ? "Saving…" : isOnline ? "Create Job" : "Save Offline"}
      </button>
    </div>
  );
}
