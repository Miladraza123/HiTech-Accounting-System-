"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setEmployeeStatusAction } from "@/app/actions/hr";
import { karachiToday } from "@/lib/karachiTime";

export function EmployeeStatusPanel({
  employeeId,
  status,
  joinDate,
}: {
  employeeId: string;
  status: string;
  joinDate: string;
}) {
  const router = useRouter();
  const [leaveDate, setLeaveDate] = useState(karachiToday());
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(next: "Active" | "Left") {
    setError(null);
    startTransition(async () => {
      const res = await setEmployeeStatusAction(employeeId, next, next === "Left" ? leaveDate : null);
      if (res.error) return setError(res.error);
      setAsking(false);
      router.refresh();
    });
  }

  if (status === "Left") {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => run("Active")}
          disabled={pending}
          className="rounded-md border border-line-strong bg-bg px-3 py-1.5 text-xs hover:bg-surface-2 transition disabled:opacity-60"
        >
          {pending ? "…" : "Re-activate employee"}
        </button>
        {error && <p className="text-xs text-bad">{error}</p>}
      </div>
    );
  }

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="rounded-md border border-bad text-bad bg-bg px-3 py-1.5 text-xs hover:bg-surface-2 transition">
        Mark as Left
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-bad bg-bad-soft p-3">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-soft">Last working day</span>
        <input type="date" value={leaveDate} min={joinDate} onChange={(e) => setLeaveDate(e.target.value)} className="input text-xs" />
      </label>
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setAsking(false)} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs">
          Back
        </button>
        <button type="button" onClick={() => run("Left")} disabled={pending} className="flex-1 rounded-md bg-bad px-2 py-1 text-xs font-medium text-white disabled:opacity-60">
          {pending ? "…" : "Confirm"}
        </button>
      </div>
    </div>
  );
}
