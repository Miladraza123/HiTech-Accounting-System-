"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProductTemplateAction, type TemplateLineInput } from "@/app/actions/jobs";
import { MaterialLineEditor, blankMaterialLine, type EditableMaterialLine } from "@/components/MaterialLineEditor";
import type { Tables } from "@/lib/supabase/database.types";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";

type AltUnit = { item_id: string; unit: string; factor: number; is_active: boolean };

// qty_per_unit must be base_unit-denominated — fn_create_job multiplies it directly
// by job_qty to produce job_material_requirements.required_qty (which itself must be
// base_unit, since it's compared against stock_availability). Convert at entry here.
function serialize(lines: EditableMaterialLine[], items: Tables<"items">[], altUnits: AltUnit[]): { result: TemplateLineInput[] | null; error: string | null } {
  const result: TemplateLineInput[] = [];
  for (const l of lines) {
    if (!l.item_id) continue;
    const item = items.find((i) => i.id === l.item_id);
    const qtyEntered = Number(l.qty) || 0;
    let baseQty = qtyEntered;
    if (item && l.unit && l.unit !== item.base_unit) {
      const alt = altUnits.find((a) => a.item_id === item.id && a.unit === l.unit && a.is_active);
      if (!alt) {
        return {
          result: null,
          error: `No conversion factor is set from unit (${l.unit}) to base unit (${item.base_unit}) for "${item.item_code}" — add "Alternate Units" in Item Master.`,
        };
      }
      baseQty = Math.round(qtyEntered * alt.factor * 1000) / 1000;
    }
    result.push({ item_id: l.item_id, qty_per_unit: baseQty, unit: item?.base_unit ?? (l.unit || undefined) });
  }
  return { result, error: null };
}

export function NewProductTemplateForm({ items, units, altUnits }: { items: Tables<"items">[]; units: Tables<"units">[]; altUnits: AltUnit[] }) {
  const router = useRouter();
  const altUnitsByItem: Record<string, { unit: string; factor: number }[]> = {};
  for (const a of altUnits) {
    if (!a.is_active) continue;
    (altUnitsByItem[a.item_id] ??= []).push({ unit: a.unit, factor: a.factor });
  }
  const [templateCode, setTemplateCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [outputItemId, setOutputItemId] = useState("");
  const [outputUnit, setOutputUnit] = useState("");
  const [lines, setLines] = useState<EditableMaterialLine[]>([blankMaterialLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);

  if (savedOffline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 max-w-xl space-y-3">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">
          Product Template saved on this device — it will sync automatically once you&apos;re back online.
        </p>
      </div>
    );
  }

  function submit() {
    setError(null);
    if (!templateCode.trim() || !name.trim()) {
      setError("Template code and name are required.");
      return;
    }
    const { result, error: convErr } = serialize(lines, items, altUnits);
    if (convErr) {
      setError(convErr);
      return;
    }
    const materialLines = result ?? [];
    if (!materialLines.length) {
      setError("At least one raw material line is required.");
      return;
    }

    if (!isOnline) {
      startTransition(async () => {
        await enqueue({
          kind: "create",
          table: "product_templates",
          recordId: crypto.randomUUID(),
          label: "Product Template",
          payload: {
            template_code: templateCode,
            name,
            description: description || null,
            output_item_id: outputItemId || null,
            output_unit: outputUnit || null,
            lines: materialLines,
          },
        });
        setSavedOffline(true);
      });
      return;
    }

    startTransition(async () => {
      const res = await createProductTemplateAction({
        template_code: templateCode,
        name,
        description: description || null,
        output_item_id: outputItemId || null,
        output_unit: outputUnit || null,
        lines: materialLines,
      });
      if (res.error) setError(res.error);
      else router.push(`/product-templates/${res.id}`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Template Code *</span>
            <input value={templateCode} onChange={(e) => setTemplateCode(e.target.value)} className="input" placeholder="e.g. TMPL-CHAIR-01" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="e.g. Steel Chair — Standard" />
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input resize-none" />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Output Item (optional)</span>
            <select value={outputItemId} onChange={(e) => setOutputItemId(e.target.value)} className="input">
              <option value="">— None —</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.item_code} — {i.description}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Output Unit</span>
            <select value={outputUnit} onChange={(e) => setOutputUnit(e.target.value)} className="input">
              <option value="">—</option>
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-ink-soft mb-2">Raw Material Requirement — per 1 output unit</p>
        <MaterialLineEditor items={items} units={units} lines={lines} onChange={setLines} qtyLabel="Qty / Unit" altUnitsByItem={altUnitsByItem} />
      </div>

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this Product Template will be saved on this device and synced automatically once
          you&apos;re back online.
        </p>
      )}

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : isOnline ? "Create Template" : "Save Offline"}
      </button>
    </div>
  );
}
