"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveLeaveTypeAction } from "@/app/actions/hr";

/** One editable leave type, or (without `type`) the "add new" row. */
export function LeaveTypeRow({ type }: { type?: { id: string; name: string; is_paid: boolean; is_active: boolean; used: boolean } }) {
  const router = useRouter();
  const [name, setName] = useState(type?.name ?? "");
  const [isPaid, setIsPaid] = useState(type?.is_paid ?? true);
  const [isActive, setIsActive] = useState(type?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const changed = !type || name !== type.name || isPaid !== type.is_paid || isActive !== type.is_active;

  function submit() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveLeaveTypeAction({ id: type?.id ?? null, name, is_paid: isPaid, is_active: isActive });
      if (res.error) return setError(res.error);
      if (!type) {
        setName("");
        setIsPaid(true);
      } else setSaved(true);
      router.refresh();
    });
  }

  return (
    <tr className="border-t border-line">
      <td className="px-4 py-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className="input text-sm" placeholder={type ? undefined : "New leave type…"} aria-label="Leave type name" />
        {error && <p className="mt-1 text-xs text-bad">{error}</p>}
      </td>
      <td className="px-4 py-2">
        <select
          value={isPaid ? "paid" : "unpaid"}
          onChange={(e) => setIsPaid(e.target.value === "paid")}
          disabled={type?.used}
          title={type?.used ? "Already used, so paid/unpaid is fixed" : undefined}
          className="input text-sm"
          aria-label="Paid or unpaid"
        >
          <option value="paid">Paid (from yearly quota)</option>
          <option value="unpaid">Unpaid</option>
        </select>
      </td>
      <td className="px-4 py-2">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      </td>
      <td className="px-4 py-2 text-right">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !changed || !name.trim()}
          className="rounded-md border border-line-strong bg-bg px-3 py-1 text-xs hover:bg-surface-2 disabled:opacity-50"
        >
          {pending ? "…" : type ? (saved && !changed ? "Saved" : "Save") : "Add"}
        </button>
      </td>
    </tr>
  );
}
