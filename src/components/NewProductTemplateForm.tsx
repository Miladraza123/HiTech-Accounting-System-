"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProductTemplateAction, type TemplateLineInput } from "@/app/actions/jobs";
import { MaterialLineEditor, blankMaterialLine, type EditableMaterialLine } from "@/components/MaterialLineEditor";
import type { Tables } from "@/lib/supabase/database.types";

function serialize(lines: EditableMaterialLine[]): TemplateLineInput[] {
  return lines
    .filter((l) => l.item_id)
    .map((l) => ({
      item_id: l.item_id,
      qty_per_unit: Number(l.qty) || 0,
      unit: l.unit || undefined,
    }));
}

export function NewProductTemplateForm({ items, units }: { items: Tables<"items">[]; units: Tables<"units">[] }) {
  const router = useRouter();
  const [templateCode, setTemplateCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [outputItemId, setOutputItemId] = useState("");
  const [outputUnit, setOutputUnit] = useState("");
  const [lines, setLines] = useState<EditableMaterialLine[]>([blankMaterialLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!templateCode.trim() || !name.trim()) {
      setError("Template code aur naam zaroori hai.");
      return;
    }
    const materialLines = serialize(lines);
    if (!materialLines.length) {
      setError("Kam az kam ek raw material line honi chahiye.");
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
        <MaterialLineEditor items={items} units={units} lines={lines} onChange={setLines} qtyLabel="Qty / Unit" />
      </div>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Save ho raha hai…" : "Template Banayen"}
      </button>
    </div>
  );
}
