"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExpenseHeadAction } from "@/app/actions/cashBank";

export function NewExpenseHeadForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Naam zaroori hai.");
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
          <span className="text-xs font-medium text-ink-soft">Naya Expense Head *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="e.g. Vehicle Toll" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Short Code (optional)</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} className="input" placeholder="e.g. TOLL" />
        </label>
      </div>
      <p className="text-xs text-ink-faint">Naya head add karne se accounting mein khud-b-khud ek nayi expense account bhi ban jayegi.</p>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Save ho raha hai…" : "Expense Head Banayen"}
      </button>
    </div>
  );
}
