"use client";

import { useState, useTransition } from "react";
import { updateItemReorderLevelAction } from "@/app/actions/items";
import { buttonClass } from "@/components/ui/Button";

export function ItemReorderLevelField({ itemId, reorderLevel }: { itemId: string; reorderLevel: number | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(reorderLevel === null ? "" : String(reorderLevel));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    const trimmed = value.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) {
      setError("Enter a non-negative number, or leave blank to turn the alert off.");
      return;
    }
    startTransition(async () => {
      const res = await updateItemReorderLevelAction(itemId, parsed);
      if (res.error) setError(res.error);
      else setEditing(false);
    });
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="text-left group">
        <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Reorder Level</p>
        <p className="text-ink mt-0.5 tabular group-hover:underline underline-offset-2">
          {reorderLevel === null ? <span className="text-ink-faint">Not set (no alert)</span> : reorderLevel}
        </p>
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Reorder Level</p>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          step="0.001"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Blank = off"
          className="input !py-1 text-xs w-28"
          autoFocus
        />
        <button type="button" onClick={save} disabled={pending} className={buttonClass("primary", "sm")}>
          {pending ? "…" : "Save"}
        </button>
        <button type="button" onClick={() => setEditing(false)} className={buttonClass("secondary", "sm")}>
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
