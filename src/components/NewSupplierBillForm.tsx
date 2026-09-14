"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupplierBillAction } from "@/app/actions/supplierBills";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";

type GrnOption = { id: string; grn_no: string; received_date: string; parties: { legal_name: string } | null };

// Phase 3 (Master Offline-First Roadmap): same offline-enqueue pattern as
// the rest of the procurement pipeline. NOTE: this is only reachable
// offline if the parent GRN already exists server-side (and this page's
// own `grns` list was fetched while last online) — see this form's own
// RPC entry in offlineQueue.ts.
export function NewSupplierBillForm({ grns }: { grns: GrnOption[] }) {
  const router = useRouter();
  const [grnId, setGrnId] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [billRef, setBillRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);

  function submit() {
    setError(null);
    if (!grnId) {
      setError("Select GRN.");
      return;
    }

    if (!isOnline) {
      startTransition(async () => {
        await enqueue({
          kind: "create",
          table: "supplier_bills",
          recordId: crypto.randomUUID(),
          label: "Supplier Bill",
          payload: { grn_id: grnId, bill_date: billDate, supplier_bill_ref: billRef || null },
        });
        setSavedOffline(true);
      });
      return;
    }

    startTransition(async () => {
      const res = await createSupplierBillAction({ grn_id: grnId, bill_date: billDate, supplier_bill_ref: billRef || null });
      if (res.error) setError(res.error);
      else router.push(`/supplier-bills/${res.id}`);
    });
  }

  if (savedOffline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 max-w-xl space-y-3">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">
          Supplier Bill saved on this device — it will get its Bill number and sync automatically once you&apos;re
          back online.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">GRN *</span>
          <select value={grnId} onChange={(e) => setGrnId(e.target.value)} className="input">
            <option value="">— Select —</option>
            {grns.map((g) => (
              <option key={g.id} value={g.id}>
                {g.grn_no} — {g.parties?.legal_name} ({g.received_date})
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Bill Date</span>
            <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} className="input" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Supplier&apos;s Bill / Invoice Ref#</span>
            <input value={billRef} onChange={(e) => setBillRef(e.target.value)} className="input" placeholder="Supplier's own invoice number" />
          </label>
        </div>

        <p className="text-xs text-ink-faint">
          All lines automatically use the same rate/tax as at the time of receiving on the GRN — no overrides, so the GRN Clearing account always stays balanced.
        </p>
      </div>

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this Supplier Bill will be saved on this device and synced automatically once
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
        {pending ? "Saving…" : isOnline ? "Create Supplier Bill" : "Save Offline"}
      </button>
    </div>
  );
}
