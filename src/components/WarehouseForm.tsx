"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { addWarehouseAction, type ActionResult } from "@/app/actions/setup";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import { useOfflineSubmitGuard } from "@/lib/useOfflineSubmitGuard";

const initialState: ActionResult = { error: null };

// Phase 1 (Master Offline-First Roadmap): Warehouse is master data every
// later stock-affecting document (GRN, Delivery, Transfer, ...) references,
// so it has to be creatable offline first. Same pattern as QueryForm.tsx
// (Phase 22 pilot): online, this form behaves exactly as before (native
// form action -> addWarehouseAction); offline, submission is intercepted
// before the native action runs and queued in IndexedDB with a
// browser-generated UUID, replayed through `fn_create_warehouse_idempotent`
// (safe to retry) the moment connectivity returns.
export function WarehouseForm() {
  const [state, formAction, pending] = useActionState(addWarehouseAction, initialState);
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
    await guard(async () => {
      await enqueue({
        kind: "create",
        table: "warehouses",
        recordId: crypto.randomUUID(),
        label: "Warehouse",
        payload: {
          code: String(formData.get("code") ?? "").trim().toUpperCase(),
          name: String(formData.get("name") ?? "").trim(),
          address: String(formData.get("address") ?? "").trim() || null,
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
        <button
          type="button"
          onClick={() => setSavedOffline(false)}
          className="rounded-md border border-line-strong bg-bg px-3 py-1.5 text-xs font-medium text-ink"
        >
          + Add another
        </button>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="rounded-xl border border-line bg-surface p-5 space-y-3">
      <div className="grid grid-cols-[120px_1fr] gap-3">
        <input name="code" placeholder="CODE" required className="input uppercase" maxLength={12} />
        <input name="name" placeholder="Warehouse name" required className="input" />
      </div>
      <input name="address" placeholder="Address (optional)" className="input" />
      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this Warehouse will be saved on this device and synced automatically once
          you&apos;re back online.
        </p>
      )}
      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      <button
        type="submit"
        disabled={pending || isSubmitting}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending || isSubmitting ? "Adding…" : isOnline ? "Add Warehouse" : "Save Offline"}
      </button>
    </form>
  );
}
