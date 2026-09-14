"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExpenseHeadAction } from "@/app/actions/cashBank";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";

export function NewExpenseHeadForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);

  function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }

    if (!isOnline) {
      startTransition(async () => {
        await enqueue({
          kind: "create",
          table: "expense_heads",
          recordId: crypto.randomUUID(),
          label: "Expense Head",
          payload: { name: name.trim(), code: code.trim() || null },
        });
        setName("");
        setCode("");
        setSavedOffline(true);
      });
      return;
    }

    startTransition(async () => {
      const res = await createExpenseHeadAction(name.trim(), code.trim() || null);
      if (res.error) {
        setError(res.error);
        return;
      }
      setName("");
      setCode("");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">New Expense Head *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="e.g. Vehicle Toll" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Short Code (optional)</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} className="input" placeholder="e.g. TOLL" />
        </label>
      </div>
      <p className="text-xs text-ink-faint">Adding a new head will automatically create a corresponding expense account in accounting.</p>
      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this Expense Head will be saved on this device and synced automatically once
          you&apos;re back online.
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
        {pending ? "Saving…" : isOnline ? "Create Expense Head" : "Save Offline"}
      </button>
    </div>
  );
}
