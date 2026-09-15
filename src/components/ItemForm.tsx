"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { createItemAction, type ActionResult } from "@/app/actions/items";
import type { Tables } from "@/lib/supabase/database.types";
import { buttonClass } from "@/components/ui/Button";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import { useOfflineSubmitGuard } from "@/lib/useOfflineSubmitGuard";

const initialState: ActionResult = { error: null };

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-ink-soft">
        {label} {required && <span className="text-bad">*</span>}
      </span>
      {children}
    </label>
  );
}

// Phase 1 (Master Offline-First Roadmap): Item is master data every later
// document (GRN, Sales Order, Delivery, ...) references, so it has to be
// creatable offline first. Same pattern as QueryForm.tsx (Phase 22 pilot):
// online, this form behaves exactly as before (native form action ->
// createItemAction); offline, submission is intercepted before the native
// action runs and queued in IndexedDB with a browser-generated UUID,
// replayed through `fn_create_item_idempotent` (safe to retry) the moment
// connectivity returns.
export function ItemForm({ units }: { units: Tables<"units">[] }) {
  const [state, formAction, pending] = useActionState(createItemAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);
  // Guards the offline branch below against a rapid double-click — see
  // useOfflineSubmitGuard's own comment for why `pending` above (from
  // useActionState) can't do this on its own for this specific path.
  const { isSubmitting, guard } = useOfflineSubmitGuard();

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (isOnline) return; // let the normal <form action> submission run, unchanged
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const reorderLevelRaw = String(formData.get("reorder_level") ?? "").trim();
    await guard(async () => {
      await enqueue({
        kind: "create",
        table: "items",
        recordId: crypto.randomUUID(),
        label: "Item",
        payload: {
          item_code: String(formData.get("item_code") ?? "").trim(),
          description: String(formData.get("description") ?? "").trim(),
          base_unit: String(formData.get("base_unit") ?? ""),
          category: String(formData.get("category") ?? "").trim() || null,
          spec: String(formData.get("spec") ?? "").trim() || null,
          hs_code: String(formData.get("hs_code") ?? "").trim() || null,
          tax_category: String(formData.get("tax_category") ?? "standard"),
          is_stocked: formData.get("is_stocked") === "on",
          standard_cost: Number(formData.get("standard_cost") ?? 0),
          reorder_level: reorderLevelRaw ? Number(reorderLevelRaw) : null,
        },
      });
      form.reset();
      setSavedOffline(true);
    });
  }

  if (savedOffline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-5 space-y-3">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">
          Saved on this device — it will sync automatically once you&apos;re back online.
        </p>
        <button type="button" onClick={() => setSavedOffline(false)} className={buttonClass("secondary", "sm")}>
          + Add another
        </button>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="rounded-xl border border-line bg-surface p-5 space-y-5">
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Basic Info</p>
        <div className="grid grid-cols-[140px_1fr] gap-3">
          <Field label="Item Code" required>
            <input name="item_code" required className="input font-mono" />
          </Field>
          <Field label="Description" required>
            <input name="description" required className="input" />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Category">
            <input name="category" placeholder="e.g. Steel" className="input" />
          </Field>
          <Field label="Spec">
            <input name="spec" placeholder="e.g. 6mm MS Sheet" className="input" />
          </Field>
          <Field label="HS Code">
            <input name="hs_code" className="input" />
          </Field>
        </div>
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Unit &amp; Tax</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Unit" required>
            <select name="base_unit" required defaultValue="" className="input">
              <option value="" disabled>
                — Select —
              </option>
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code} — {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tax Category">
            <select name="tax_category" defaultValue="standard" className="input">
              <option value="standard">Standard Tax</option>
              <option value="reduced">Reduced Rate</option>
              <option value="zero_rated">Zero-rated</option>
              <option value="exempt">Exempt</option>
            </select>
          </Field>
          <Field label="Standard Cost">
            <input name="standard_cost" type="number" step="0.0001" min="0" className="input" />
          </Field>
        </div>
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Stock Tracking</p>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="is_stocked" defaultChecked className="h-3.5 w-3.5 accent-[var(--accent)]" />
          This item will be kept in warehouse stock (raw material / stocked goods)
        </label>
        <p className="text-xs text-ink-faint">
          Quantities aren&apos;t set here — they move on their own as GRNs, deliveries, and other stock documents are
          posted. If this item already has stock on hand from before HiTech (e.g. migrating from another system), add
          that as an <span className="font-medium text-ink-soft">Opening Stock</span> from Setup → Import once it&apos;s
          created here.
        </p>
        <Field label="Reorder Level (optional)">
          <input name="reorder_level" type="number" step="0.001" min="0" placeholder="Leave blank for no low-stock alert" className="input" />
        </Field>
        <p className="text-xs text-ink-faint">
          When total stock on hand (across all warehouses) falls to or below this, it shows up in the low-stock
          notification bell. Can also be set later from the item&apos;s own page.
        </p>
      </div>

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this Item will be saved on this device and synced automatically once you&apos;re
          back online.
        </p>
      )}

      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      {state.success && <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">Added.</p>}

      <div className="border-t border-line pt-4">
        <button type="submit" disabled={pending || isSubmitting} className={buttonClass("primary", "md", "disabled:opacity-60")}>
          {pending || isSubmitting ? "Adding…" : isOnline ? "Add Item" : "Save Offline"}
        </button>
      </div>
    </form>
  );
}
