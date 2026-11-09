"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createServiceMaterialDocAction } from "@/app/actions/serviceJobs";
import { SearchablePicker, ITEM_SOURCE, ACTIVE_ONLY, type PickerOption } from "@/components/SearchablePicker";
import { karachiToday } from "@/lib/karachiTime";

type Row = { key: string; item_id: string; label: string; unit: string; qty: string };

let seq = 0;
const blank = (): Row => ({ key: `r${++seq}`, item_id: "", label: "", unit: "", qty: "1" });

/**
 * Issue material to a Service Job (a Site Material DC) or record material that came back.
 * Stock moves and the job's cost is written by the database; this only collects the lines.
 */
export function ServiceMaterialForm({
  serviceJobId,
  warehouses,
}: {
  serviceJobId: string;
  warehouses: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"issue" | "return" | null>(null);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [date, setDate] = useState(karachiToday());
  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [remarks, setRemarks] = useState("");
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
    setRemarks("");
    setError(null);
  }

  function submit() {
    if (!mode) return;
    setError(null);
    const lines = rows.filter((r) => r.item_id).map((r) => ({ item_id: r.item_id, qty: Number(r.qty) }));
    if (!lines.length) return setError("Add at least one item.");
    startTransition(async () => {
      const res = await createServiceMaterialDocAction({
        service_job_id: serviceJobId,
        kind: mode,
        warehouse_id: warehouseId,
        doc_date: date,
        vehicle_no: vehicle,
        driver_name: driver,
        remarks,
        lines,
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
          + Issue Material (Site DC)
        </button>
        <button type="button" onClick={() => setMode("return")} className="rounded-md border border-line-strong px-3 py-1.5 text-xs">
          Material Returned
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <h3 className="text-sm font-semibold text-ink">{mode === "issue" ? "Issue material to this job (Site Material DC)" : "Record material returned from site"}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-soft">{mode === "issue" ? "Issue from warehouse" : "Return to warehouse"} *</span>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input">
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-soft">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </label>
        {mode === "issue" && (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink-soft">Vehicle No.</span>
              <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="input" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink-soft">Driver</span>
              <input value={driver} onChange={(e) => setDriver(e.target.value)} className="input" />
            </label>
          </>
        )}
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[12rem]">
              <SearchablePicker
                name={`mat_item_${r.key}`}
                source={ITEM_SOURCE}
                filters={ACTIVE_ONLY}
                initialOptions={[]}
                initialSelected={r.item_id ? { id: r.item_id, label: r.label } : null}
                placeholder="Item code or name…"
                onChange={(o) => pick(r.key, o)}
              />
            </div>
            <input
              type="number"
              step="0.001"
              min="0.001"
              value={r.qty}
              onChange={(e) => patch(r.key, { qty: e.target.value })}
              className="input w-24 text-right tabular"
              aria-label="Quantity"
            />
            <span className="w-12 text-xs text-ink-faint">{r.unit}</span>
            <button
              type="button"
              onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))}
              className="text-ink-faint hover:text-bad"
              aria-label="Remove line"
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setRows((rs) => [...rs, blank()])} className="text-xs text-accent-ink underline underline-offset-2">
          + Add item
        </button>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-soft">Remarks</span>
        <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="input" />
      </label>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={reset} className="rounded-md border border-line-strong px-3 py-1.5 text-xs">
          Cancel
        </button>
        <button type="button" disabled={pending} onClick={submit} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
          {pending ? "Saving…" : mode === "issue" ? "Issue Material" : "Record Return"}
        </button>
      </div>
    </div>
  );
}
