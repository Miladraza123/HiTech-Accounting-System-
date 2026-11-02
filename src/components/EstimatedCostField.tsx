"use client";

/** Optional "what this order will cost us" input for the Sales Order forms (Owner/Accounts only — the parent decides). */
export function EstimatedCostField({ value, onChange, disabled = false }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="block space-y-1.5 max-w-xs">
      <span className="text-xs font-medium text-ink-soft">Estimated cost of this order (Rs) — optional</span>
      <input
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="e.g. 450000"
        className="input tabular"
      />
      <span className="block text-[11px] text-ink-faint">
        {disabled ? "Offline — set it from the order page once you're back online." : "Only Owner and Accounts can see this. You can also add or change it later on the order page."}
      </span>
    </label>
  );
}

/** Empty string → null (not set); otherwise the number, or undefined when it isn't a valid non-negative amount. */
export function parseEstimatedCost(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
