"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addHolidayAction } from "@/app/actions/hr";

export function HolidayForm() {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!date || !name.trim()) return setError("Date and name are required.");
    startTransition(async () => {
      const res = await addHolidayAction(date, name);
      if (res.error) return setError(res.error);
      setDate("");
      setName("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-soft">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </label>
        <label className="block space-y-1 flex-1 min-w-[12rem]">
          <span className="text-xs font-medium text-ink-soft">Holiday name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="e.g. Eid ul Fitr" />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "Saving…" : "Add Holiday"}
        </button>
      </div>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
