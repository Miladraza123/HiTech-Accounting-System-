"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyFixedChargeAction } from "@/app/actions/hr";

/** One charge (e.g. Lunch) for many employees at once. */
export function ApplyFixedChargeForm({ employees }: { employees: { id: string; code: string; full_name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function apply() {
    setMsg(null);
    startTransition(async () => {
      const res = await applyFixedChargeAction(name, Number(amount), [...picked]);
      if (res.error) return setMsg({ ok: false, text: res.error });
      setMsg({ ok: true, text: `"${name.trim()}" set for ${res.count} employee(s). An employee who already had it gets the new amount.` });
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <h2 className="text-sm font-semibold text-ink">Same charge for many employees</h2>
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Charge name (e.g. Lunch)" maxLength={60} className="input text-sm w-56" aria-label="Charge name" />
        <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" className="input text-sm w-32" aria-label="Amount" />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <button type="button" onClick={() => setPicked(new Set(employees.map((e) => e.id)))} className="text-xs text-accent-ink underline underline-offset-2">
          Select all
        </button>
        <button type="button" onClick={() => setPicked(new Set())} className="text-xs text-accent-ink underline underline-offset-2">
          Clear
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        {employees.map((e) => (
          <label key={e.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
            <span>
              {e.full_name} <span className="font-mono text-xs text-ink-faint">{e.code}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={apply} className="rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-60">
          {pending ? "Saving…" : `Apply to ${picked.size} employee(s)`}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span>}
      </div>
    </section>
  );
}
