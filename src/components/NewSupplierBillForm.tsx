"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupplierBillAction } from "@/app/actions/supplierBills";

type GrnOption = { id: string; grn_no: string; received_date: string; parties: { legal_name: string } | null };

export function NewSupplierBillForm({ grns }: { grns: GrnOption[] }) {
  const router = useRouter();
  const [grnId, setGrnId] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [billRef, setBillRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!grnId) {
      setError("GRN select karen.");
      return;
    }
    startTransition(async () => {
      const res = await createSupplierBillAction({ grn_id: grnId, bill_date: billDate, supplier_bill_ref: billRef || null });
      if (res.error) setError(res.error);
      else router.push(`/supplier-bills/${res.id}`);
    });
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
            <input value={billRef} onChange={(e) => setBillRef(e.target.value)} className="input" placeholder="Supplier ka apna invoice number" />
          </label>
        </div>

        <p className="text-xs text-ink-faint">
          GRN ki tamam lines ke rate/tax automatically wahi honge jo receiving ke waqt the — koi override nahi, taake GRN Clearing hamesha balance rahe.
        </p>
      </div>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Save ho raha hai…" : "Supplier Bill Banayen"}
      </button>
    </div>
  );
}
