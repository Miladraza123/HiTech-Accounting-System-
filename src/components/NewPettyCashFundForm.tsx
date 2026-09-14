"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPettyCashFundAction } from "@/app/actions/cashBank";
import type { Tables } from "@/lib/supabase/database.types";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";

export function NewPettyCashFundForm({ profiles }: { profiles: Tables<"profiles">[] }) {
  const router = useRouter();
  const [fundName, setFundName] = useState("");
  const [custodianId, setCustodianId] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);

  function submit() {
    setError(null);
    if (!fundName.trim()) {
      setError("Fund name is required.");
      return;
    }

    const payload = {
      fund_name: fundName.trim(),
      custodian_user_id: custodianId || null,
      opening_balance: Number(openingBalance) || 0,
      opening_balance_date: openingDate,
    };

    if (!isOnline) {
      startTransition(async () => {
        await enqueue({ kind: "create", table: "petty_cash_funds", recordId: crypto.randomUUID(), label: "Petty Cash Fund", payload });
        setFundName("");
        setCustodianId("");
        setOpeningBalance("0");
        setSavedOffline(true);
      });
      return;
    }

    startTransition(async () => {
      const res = await createPettyCashFundAction(payload);
      if (res.error) {
        setError(res.error);
        return;
      }
      setFundName("");
      setCustodianId("");
      setOpeningBalance("0");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Fund Name *</span>
          <input value={fundName} onChange={(e) => setFundName(e.target.value)} className="input" placeholder="e.g. Site Office Petty Cash" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Custodian</span>
          <select value={custodianId} onChange={(e) => setCustodianId(e.target.value)} className="input">
            <option value="">— None —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Opening Balance</span>
          <input type="number" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Opening Balance Date</span>
          <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} className="input" />
        </label>
      </div>
      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this will be saved on this device and synced automatically once you&apos;re back
          online.
        </p>
      )}
      {savedOffline && <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">⏳ Saved offline — waiting to sync.</p>}
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : isOnline ? "Create Petty Cash Fund" : "Save Offline"}
      </button>
    </div>
  );
}
