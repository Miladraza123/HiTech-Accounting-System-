"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changePartyTypeAction, updatePartyDetailsAction } from "@/app/actions/parties";
import { PARTY_DETAIL_LABEL, normalizePartyDetails, type PartyDetails } from "@/lib/partyDetails";
import type { SmartMergeConflict } from "@/lib/smartMerge";
import type { Tables } from "@/lib/supabase/database.types";

const TYPE_LABEL: Record<string, string> = { client: "Client", supplier: "Supplier", both: "Client + Supplier" };

/**
 * Name, NTN, STRN, CNIC, address, province and type of a client/supplier. Details go through Smart Merge
 * (only changed fields are written; a field someone else changed meanwhile asks which value to keep).
 * The type has its own button because the database refuses to drop a role that already has documents.
 */
export function EditPartyDetailsForm({
  partyId,
  initial,
  partyType,
  provinces,
}: {
  partyId: string;
  initial: PartyDetails;
  partyType: string;
  provinces: Pick<Tables<"provinces">, "code" | "name">[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // what this tab believes is saved; advances when a conflict is settled in favour of the server's value
  const [base, setBase] = useState<PartyDetails>(initial);
  const [form, setForm] = useState<PartyDetails>(initial);
  const [type, setType] = useState(partyType);
  const [error, setError] = useState<string | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SmartMergeConflict[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof PartyDetails, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-accent-ink underline underline-offset-2">
        Edit details
      </button>
    );
  }

  function save() {
    setError(null);
    setSaved(false);
    if (!form.legal_name.trim()) {
      setError("Name is required.");
      return;
    }
    startTransition(async () => {
      const res = await updatePartyDetailsAction(partyId, base, form);
      if (res.error) setError(res.error);
      else if (res.conflicts && res.conflicts.length > 0) setConflicts(res.conflicts);
      else {
        setConflicts([]);
        setBase(normalizedToForm(form));
        setSaved(true);
        router.refresh();
      }
    });
  }

  function resolve(c: SmartMergeConflict, choice: "mine" | "theirs") {
    const server = c.server_value === null || c.server_value === undefined ? "" : String(c.server_value);
    setBase((b) => ({ ...b, [c.field]: server }));
    if (choice === "theirs") setForm((f) => ({ ...f, [c.field]: server }));
    setConflicts((cs) => cs.filter((x) => x.field !== c.field));
  }

  function changeType() {
    setTypeError(null);
    startTransition(async () => {
      const res = await changePartyTypeAction(partyId, type);
      if (res.error) {
        setTypeError(res.error);
        setType(partyType);
      } else router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-line bg-bg p-3">
      {conflicts.length > 0 && (
        <div className="space-y-2 rounded-md border border-warn bg-warn-soft p-2 text-xs text-ink">
          <p className="font-medium text-warn">Someone else changed this in the meantime — choose which value to keep:</p>
          {conflicts.map((c) => (
            <div key={c.field} className="space-y-1 rounded border border-line-strong bg-bg p-2">
              <p className="text-ink-soft">
                <span className="font-medium">{PARTY_DETAIL_LABEL[c.field as keyof PartyDetails] ?? c.field}</span> — saved now: <span className="font-mono">{String(c.server_value ?? "—")}</span>, yours:{" "}
                <span className="font-mono">{String(c.my_value ?? "—")}</span>
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => resolve(c, "mine")} className="flex-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white">
                  Keep my value
                </button>
                <button type="button" onClick={() => resolve(c, "theirs")} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-[11px]">
                  Keep the saved value
                </button>
              </div>
            </div>
          ))}
          <p className="text-ink-faint">Then click Save again. Your other changes were already saved.</p>
        </div>
      )}

      <label className="block space-y-1">
        <span className="text-[11px] text-ink-faint">Name *</span>
        <input value={form.legal_name} onChange={(e) => set("legal_name", e.target.value)} maxLength={200} className="input !py-1.5 text-sm" />
        <span className="text-[11px] text-ink-faint">Documents show the current name wherever they are printed, including older ones.</span>
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">NTN</span>
          <input value={form.ntn} onChange={(e) => set("ntn", e.target.value)} className="input !py-1.5 text-sm" />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">STRN (GST No.)</span>
          <input value={form.strn} onChange={(e) => set("strn", e.target.value)} className="input !py-1.5 text-sm" />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">CNIC (if individual)</span>
          <input value={form.cnic} onChange={(e) => set("cnic", e.target.value)} className="input !py-1.5 text-sm" />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-[11px] text-ink-faint">Address</span>
        <textarea value={form.billing_address} onChange={(e) => set("billing_address", e.target.value)} rows={2} className="input !py-1.5 text-sm resize-y" />
      </label>
      <label className="block space-y-1 max-w-xs">
        <span className="text-[11px] text-ink-faint">Province</span>
        <select value={form.province} onChange={(e) => set("province", e.target.value)} className="input !py-1.5 text-sm">
          <option value="">— None —</option>
          {provinces.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="text-xs text-bad">{error}</p>}
      {saved && <p className="text-xs text-good">Saved.</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-md border border-line-strong bg-bg px-3 py-1 text-xs disabled:opacity-60">
          Close
        </button>
        <button type="button" onClick={save} disabled={pending} className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-60">
          {pending ? "Saving…" : "Save details"}
        </button>
      </div>

      <div className="space-y-1.5 border-t border-line pt-3">
        <span className="text-[11px] text-ink-faint">Type</span>
        <div className="flex flex-wrap items-center gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)} className="input !py-1.5 text-sm !w-auto">
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button type="button" onClick={changeType} disabled={pending || type === partyType} className="rounded-md border border-line-strong bg-bg px-3 py-1 text-xs disabled:opacity-50">
            Change type
          </button>
        </div>
        <p className="text-[11px] text-ink-faint">
          Making a client also a supplier (or the reverse) is always possible. Removing a role is only possible while there are no documents in that role.
        </p>
        {typeError && <p className="text-xs text-bad">{typeError}</p>}
      </div>
    </div>
  );
}

function normalizedToForm(d: PartyDetails): PartyDetails {
  const n = normalizePartyDetails(d);
  return { legal_name: n.legal_name, ntn: n.ntn ?? "", strn: n.strn ?? "", cnic: n.cnic ?? "", billing_address: n.billing_address ?? "", province: n.province ?? "" };
}
