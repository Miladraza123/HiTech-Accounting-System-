"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelJobWithDispositionAction } from "@/app/actions/jobs";
import { SearchablePicker, ITEM_SOURCE, type PickerFilter, type PickerOption } from "@/components/SearchablePicker";

/** Only an active, stocked item can receive the finished goods. */
const STOCKED_ACTIVE: PickerFilter[] = [
  { column: "is_active", op: "eq", value: true },
  { column: "is_stocked", op: "eq", value: true },
];

export type IssuedMaterialLine = { item_code: string; description: string; qty: number; unit: string | null };

export type JobCancelDispositionData = {
  jobWarehouseId: string;
  /** Net issued material cost on the job (issued − returned), i.e. its WIP. */
  materialCost: number;
  /** Sum of Posted expenses booked against the job. */
  jobExpenses: number;
  issuedLines: IssuedMaterialLine[];
  warehouses: { id: string; name: string }[];
  units: { code: string; name: string }[];
  itemOptions: PickerOption[];
};

const fmt = (n: number) => n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Owner-only "Cancel Job" for a job that already holds issued material
 * (incl. Ready for Dispatch). The owner decides where the job's cost goes:
 *  - convert: into a finished stock item (existing or new), optionally with
 *    the job's booked expenses capitalised too;
 *  - restock: every issued-not-returned raw material back to stock at its
 *    issue cost.
 * Runs fn_cancel_job_with_disposition — one transaction on the server.
 */
export function JobCancelDispositionDialog({
  jobId,
  data,
  onClose,
}: {
  jobId: string;
  data: JobCancelDispositionData;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"convert" | "restock">("convert");
  const [itemMode, setItemMode] = useState<"existing" | "new">("existing");
  const [itemId, setItemId] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [warehouseId, setWarehouseId] = useState(data.jobWarehouseId);
  const [qty, setQty] = useState("1");
  const [includeExpenses, setIncludeExpenses] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const itemCost = data.materialCost + (includeExpenses ? data.jobExpenses : 0);
  const qtyNum = Number(qty);
  const unitRate = qtyNum > 0 ? itemCost / qtyNum : 0;

  function submit() {
    setError(null);
    if (!reason.trim()) {
      setError("A reason for cancelling is required.");
      return;
    }
    if (mode === "convert") {
      if (!(qtyNum > 0)) {
        setError("Qty must be greater than zero.");
        return;
      }
      if (itemMode === "existing" && !itemId) {
        setError("Pick the finished item.");
        return;
      }
      if (itemMode === "new" && (!newCode.trim() || !newDescription.trim() || !newUnit)) {
        setError("Item code, description and unit are required for a new item.");
        return;
      }
    }
    startTransition(async () => {
      const res = await cancelJobWithDispositionAction({
        jobId,
        mode,
        reason,
        itemId: mode === "convert" && itemMode === "existing" ? itemId : null,
        newItem:
          mode === "convert" && itemMode === "new"
            ? { item_code: newCode.trim(), description: newDescription.trim(), base_unit: newUnit }
            : null,
        warehouseId: mode === "convert" ? warehouseId : null,
        qty: mode === "convert" ? qtyNum : null,
        includeExpenses: mode === "convert" && includeExpenses,
      });
      if (res.error) setError(res.error);
      else {
        onClose();
        router.refresh();
      }
    });
  }

  const optionClass = (active: boolean) =>
    `flex-1 rounded-md border px-2 py-1.5 text-xs text-left transition ${
      active ? "border-accent bg-accent-soft text-accent-ink font-medium" : "border-line-strong bg-bg text-ink-soft hover:bg-surface-2"
    }`;

  return (
    <div className="space-y-3 rounded-md border border-bad bg-bad-soft p-3">
      <p className="text-xs font-semibold text-bad">Cancel Job — what happens to its material?</p>

      <div className="grid grid-cols-2 gap-2 rounded-md bg-bg p-2 text-xs tabular">
        <div>
          <p className="text-ink-faint">Material cost (WIP)</p>
          <p className="font-medium text-ink">{fmt(data.materialCost)}</p>
        </div>
        <div>
          <p className="text-ink-faint">Job expenses booked</p>
          <p className="font-medium text-ink">{fmt(data.jobExpenses)}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => setMode("convert")} className={optionClass(mode === "convert")}>
          Convert to finished item
        </button>
        <button type="button" onClick={() => setMode("restock")} className={optionClass(mode === "restock")}>
          Return materials to stock
        </button>
      </div>

      {mode === "convert" ? (
        <div className="space-y-2">
          <div className="flex gap-3 text-xs text-ink-soft">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={itemMode === "existing"} onChange={() => setItemMode("existing")} />
              Existing item
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={itemMode === "new"} onChange={() => setItemMode("new")} />
              New item
            </label>
          </div>

          {itemMode === "existing" ? (
            <SearchablePicker
              name="finished_item_id"
              source={ITEM_SOURCE}
              filters={STOCKED_ACTIVE}
              initialOptions={data.itemOptions}
              placeholder="Type an item code…"
              onChange={(o) => setItemId(o?.id ?? "")}
            />
          ) : (
            <div className="space-y-2">
              <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Item code" className="input !py-1 text-xs" />
              <input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Description" className="input !py-1 text-xs" />
              <select value={newUnit} onChange={(e) => setNewUnit(e.target.value)} className="input !py-1 text-xs" aria-label="Base unit">
                <option value="">— Base unit —</option>
                {data.units.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.code} — {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-[11px] text-ink-soft">Warehouse</span>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input !py-1 text-xs w-full">
                {data.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] text-ink-soft">Finished qty</span>
              <input
                type="number"
                step="0.001"
                min="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="Qty"
                className="input !py-1 text-xs w-full"
              />
            </label>
          </div>

          <label className="flex items-start gap-1.5 text-xs text-ink-soft">
            <input type="checkbox" checked={includeExpenses} onChange={(e) => setIncludeExpenses(e.target.checked)} className="mt-0.5" />
            <span>Include labour/other expenses booked on this job ({fmt(data.jobExpenses)}) — moves them from expense into the item&apos;s cost. Once capitalised, these expenses can no longer be cancelled.</span>
          </label>

          <p className="text-xs text-ink tabular">
            Item cost: <span className="font-medium">{fmt(itemCost)}</span>
            {qtyNum > 0 && <span className="text-ink-faint"> ({fmt(unitRate)} per unit)</span>}
          </p>
          <p className="text-xs text-ink-faint">The raw materials stay consumed — they are not put back into stock.</p>
        </div>
      ) : (
        <div className="space-y-1 text-xs">
          {data.issuedLines.length ? (
            <ul className="space-y-0.5 rounded-md bg-bg p-2">
              {data.issuedLines.map((l) => (
                <li key={l.item_code} className="flex justify-between gap-2">
                  <span className="text-ink">{l.item_code} — {l.description}</span>
                  <span className="tabular text-ink-soft whitespace-nowrap">
                    {l.qty} {l.unit ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-faint">No issued material is outstanding on this job.</p>
          )}
          <p className="text-ink-faint">Each item goes back to the job&apos;s warehouse at its issue cost. Job expenses stay as expenses.</p>
        </div>
      )}

      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason for cancelling…" className="input resize-none text-xs" />

      {error && <p className="rounded-md bg-bg px-2 py-1.5 text-xs text-bad">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs">
          Back
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="flex-1 rounded-md bg-bad px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
        >
          {pending ? "…" : "Confirm Cancel"}
        </button>
      </div>
    </div>
  );
}
