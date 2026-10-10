"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createServiceJobAction } from "@/app/actions/serviceJobs";
import { SearchablePicker, PARTY_SOURCE, type PickerFilter } from "@/components/SearchablePicker";
import type { Tables } from "@/lib/supabase/database.types";

const CLIENT_FILTERS: PickerFilter[] = [
  { column: "is_active", op: "eq", value: true },
  { column: "party_type", op: "in", value: ["client", "both"] },
];

export function NewServiceJobForm({ clientParties }: { clientParties: Pick<Tables<"parties">, "id" | "legal_name">[] }) {
  const router = useRouter();
  const [partyId, setPartyId] = useState("");
  const [assetDescription, setAssetDescription] = useState("");
  const [customerDcNo, setCustomerDcNo] = useState("");
  const [customerDcDate, setCustomerDcDate] = useState("");
  const [conditionNotes, setConditionNotes] = useState("");
  const [clientPo, setClientPo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function submit() {
    setError(null);
    if (!partyId) {
      setError("Select the client.");
      return;
    }
    if (!assetDescription.trim()) {
      setError("Describe the machine/part.");
      return;
    }
    if (!clientPo.trim()) {
      setError("Enter the client's PO number.");
      return;
    }
    startTransition(async () => {
      const res = await createServiceJobAction({
        party_id: partyId,
        asset_description: assetDescription,
        customer_dc_no: customerDcNo || null,
        customer_dc_date: customerDcDate || null,
        received_condition_notes: conditionNotes || null,
        client_po_no: clientPo,
      });
      if (res.error) setError(res.error);
      else if (res.id) router.push(`/service-jobs/${res.id}`);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition"
      >
        + New Service Job
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
      <h2 className="text-sm font-semibold text-ink">New Service Job — Intake</h2>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Client *</span>
        <SearchablePicker name="party_id" source={PARTY_SOURCE} filters={CLIENT_FILTERS} initialOptions={clientParties.map((p) => ({ id: p.id, label: p.legal_name }))} placeholder="Type a client name…" onChange={(o) => setPartyId(o?.id ?? "")} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Machine/Part Description *</span>
        <input value={assetDescription} onChange={(e) => setAssetDescription(e.target.value)} className="input" placeholder="e.g. 5HP Motor, Model XYZ" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Client PO No. *</span>
        <input value={clientPo} onChange={(e) => setClientPo(e.target.value)} className="input" placeholder="e.g. 4500101166" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Client&apos;s DC # (if any)</span>
          <input value={customerDcNo} onChange={(e) => setCustomerDcNo(e.target.value)} className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Client&apos;s DC Date</span>
          <input type="date" value={customerDcDate} onChange={(e) => setCustomerDcDate(e.target.value)} className="input" />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Condition on Receipt</span>
        <input value={conditionNotes} onChange={(e) => setConditionNotes(e.target.value)} className="input" placeholder="e.g. burnt winding, casing cracked" />
      </label>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60">
          {pending ? "Saving…" : "Create Service Job"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line px-4 py-2 text-sm text-ink-soft hover:bg-surface-2 transition">
          Cancel
        </button>
      </div>
    </div>
  );
}
