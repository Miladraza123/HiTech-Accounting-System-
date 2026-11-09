"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSiteMaterialDocAction } from "@/app/actions/siteMaterial";
import { SearchablePicker, ITEM_SOURCE, ACTIVE_ONLY, type PickerOption } from "@/components/SearchablePicker";
import { karachiToday } from "@/lib/karachiTime";

type Row = { key: string; stock: boolean; item_id: string; label: string; custom_name: string; unit: string; qty: string; unit_cost: string; description: string };

let seq = 0;
const blank = (): Row => ({ key: `r${++seq}`, stock: true, item_id: "", label: "", custom_name: "", unit: "", qty: "1", unit_cost: "", description: "" });

/**
 * The Raw Material DC (Site Material DC) form, for a Service Job or a Fabrication Job: issue material to
 * site, or record material that came back. A line is either a stock item (stock moves) or a custom item
 * (typed name, no stock, cost typed in: shown on the job, never posted to the accounts).
 */
export function SiteMaterialForm({
  serviceJobId,
  jobId,
  warehouses,
  fixedWarehouseName,
  defaultReference = "",
}: {
  serviceJobId?: string;
  jobId?: string;
  /** Service Jobs: the warehouse to issue from is chosen here. */
  warehouses?: { id: string; name: string }[];
  /** Fabrication Jobs: the job's own warehouse (shown, not chosen). */
  fixedWarehouseName?: string;
  /** Pre-filled Ref/PO Number (the job's client PO); can be changed or cleared. */
  defaultReference?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"issue" | "return" | null>(null);
  const [warehouseId, setWarehouseId] = useState(warehouses?.[0]?.id ?? "");
  const [date, setDate] = useState(karachiToday());
  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [reference, setReference] = useState(defaultReference);
  const [dcDescription, setDcDescription] = useState("");
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  function pick(key: string, o: PickerOption | null) {
    const item = o?.row as { id: string; base_unit?: string } | undefined;
    if (!item) return patch(key, { item_id: "", label: "", unit: "" });
    patch(key, { item_id: item.id, label: o?.label ?? "", unit: item.base_unit ?? "" });
  }

  function reset() {
    setMode(null);
    setRows([blank()]);
    setVehicle("");
    setDriver("");
    setReference(defaultReference);
    setDcDescription("");
    setError(null);
  }

  function submit() {
    if (!mode) return;
    setError(null);
    const used = rows.filter((r) => (r.stock ? r.item_id : r.custom_name.trim()));
    if (!used.length) return setError("Add at least one item.");
    startTransition(async () => {
      const res = await createSiteMaterialDocAction({
        service_job_id: serviceJobId,
        job_id: jobId,
        kind: mode,
        warehouse_id: warehouseId || undefined,
        doc_date: date,
        vehicle_no: vehicle,
        driver_name: driver,
        reference,
        dc_description: dcDescription,
        lines: used.map((r) =>
          r.stock
            ? { is_stock: true, item_id: r.item_id, qty: Number(r.qty), description: r.description }
            : {
                is_stock: false,
                custom_name: r.custom_name,
                qty: Number(r.qty),
                unit: r.unit,
                unit_cost: r.unit_cost === "" ? 0 : Number(r.unit_cost),
                description: r.description,
              }
        ),
      });
      if (res.error) return setError(res.error);
      reset();
      router.refresh();
    });
  }

  if (!mode) {
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setMode("issue")} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white">
          + Issue Material (Raw Material DC)
        </button>
        <button type="button" onClick={() => setMode("return")} className="rounded-md border border-line-strong px-3 py-1.5 text-xs">
          Material Returned
        </button>
      </div>
    );
  }
  const issue = mode === "issue";

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <h3 className="text-sm font-semibold text-ink">{issue ? "Raw Material DC (material issued to this job)" : "Record material returned from site"}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {warehouses ? (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-ink-soft">{issue ? "Issue stock from warehouse" : "Return to warehouse"}</span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input">
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="space-y-1">
            <span className="text-xs font-medium text-ink-soft">Warehouse</span>
            <p className="input !bg-surface-2">{fixedWarehouseName ?? "The job's warehouse"}</p>
          </div>
        )}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-soft">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </label>
        {issue && (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink-soft">Ref/PO Number (optional)</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className="input" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink-soft">DC Description (optional, prints as Project)</span>
              <input value={dcDescription} onChange={(e) => setDcDescription(e.target.value)} className="input" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink-soft">Vehicle No. (optional)</span>
              <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="input" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink-soft">Driver Name (optional)</span>
              <input value={driver} onChange={(e) => setDriver(e.target.value)} className="input" />
            </label>
          </>
        )}
      </div>

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.key} className="rounded-lg border border-line p-2.5 space-y-2">
            {issue && (
              <label className="flex items-center gap-2 text-xs text-ink-soft">
                <input type="checkbox" checked={r.stock} onChange={(e) => patch(r.key, { stock: e.target.checked })} />
                Stock se minus karna hai
                {!r.stock && <span className="text-ink-faint">(custom item: stock par asar nahi, cost sirf job mein dikhegi)</span>}
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {r.stock ? (
                <div className="flex-1 min-w-[12rem]">
                  <SearchablePicker
                    name={`mat_item_${r.key}`}
                    source={ITEM_SOURCE}
                    filters={ACTIVE_ONLY}
                    initialOptions={[]}
                    initialSelected={r.item_id ? { id: r.item_id, label: r.label } : null}
                    placeholder="Stock item code or name…"
                    onChange={(o) => pick(r.key, o)}
                  />
                </div>
              ) : (
                <input
                  value={r.custom_name}
                  onChange={(e) => patch(r.key, { custom_name: e.target.value })}
                  placeholder="Custom item name"
                  maxLength={200}
                  className="input flex-1 min-w-[12rem]"
                  aria-label="Custom item name"
                />
              )}
              <input
                type="number"
                step="0.001"
                min="0.001"
                value={r.qty}
                onChange={(e) => patch(r.key, { qty: e.target.value })}
                className="input w-24 text-right tabular"
                aria-label="Quantity"
              />
              {r.stock ? (
                <span className="w-14 text-xs text-ink-faint">{r.unit}</span>
              ) : (
                <>
                  <input value={r.unit} onChange={(e) => patch(r.key, { unit: e.target.value })} placeholder="Unit" className="input w-20" aria-label="Unit" />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={r.unit_cost}
                    onChange={(e) => patch(r.key, { unit_cost: e.target.value })}
                    placeholder="Cost / unit"
                    className="input w-28 text-right tabular"
                    aria-label="Cost per unit"
                  />
                </>
              )}
              <button
                type="button"
                onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))}
                className="text-ink-faint hover:text-bad"
                aria-label="Remove line"
              >
                ×
              </button>
            </div>
            <input
              value={r.description}
              onChange={(e) => patch(r.key, { description: e.target.value })}
              placeholder="Item description (optional, prints in Remarks)"
              className="input text-xs"
              aria-label="Item description"
            />
          </div>
        ))}
        <button type="button" onClick={() => setRows((rs) => [...rs, blank()])} className="text-xs text-accent-ink underline underline-offset-2">
          + Add item
        </button>
      </div>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={reset} className="rounded-md border border-line-strong px-3 py-1.5 text-xs">
          Cancel
        </button>
        <button type="button" disabled={pending} onClick={submit} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
          {pending ? "Saving…" : issue ? "Issue Material" : "Record Return"}
        </button>
      </div>
    </div>
  );
}
