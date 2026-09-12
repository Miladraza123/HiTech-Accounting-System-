"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateDailySnapshotAction } from "@/app/actions/snapshots";

export function GenerateSnapshotButton() {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await generateDailySnapshotAction(date);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input !py-1.5 text-xs" />
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60 whitespace-nowrap"
      >
        {pending ? "…" : "Snapshot Generate Karen"}
      </button>
      {error && <p className="text-xs text-bad w-full">{error}</p>}
    </div>
  );
}
