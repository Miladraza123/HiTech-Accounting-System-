"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPolicyVersionAction } from "@/app/actions/hr";
import { ruleSetProblems, type HrRules } from "@/lib/hrRules";
import { PolicyRulesEditor, hasBlankNumber } from "@/components/PolicyRulesEditor";
import { EffectiveDateField } from "@/components/EffectiveDateField";

/** "Change policy": starts from the latest rules and saves them as a new version from the chosen date. */
export function PolicyVersionForm({ groupId, latest, firstFrom }: { groupId: string; latest: HrRules; firstFrom: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<HrRules>(latest);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setRules(latest);
          setOpen(true);
        }}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition"
      >
        Change Policy
      </button>
    );
  }

  function submit() {
    setError(null);
    if (!effectiveFrom) return setError("Choose the date this change starts from.");
    if (hasBlankNumber(rules)) return setError("Fill every number box.");
    const problems = ruleSetProblems(rules);
    if (problems.length) return setError(problems[0]);
    startTransition(async () => {
      const res = await setPolicyVersionAction({ group_id: groupId, effective_from: effectiveFrom, rules, reason });
      if (res.error) return setError(res.error);
      setOpen(false);
      setEffectiveFrom("");
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-accent bg-surface p-4 sm:p-5 space-y-4">
      <h2 className="text-sm font-semibold text-ink">Change Policy</h2>
      <EffectiveDateField value={effectiveFrom} onChange={setEffectiveFrom} min={firstFrom} />
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Reason / note</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} className="input" placeholder="e.g. Ramzan timing" />
      </label>
      <PolicyRulesEditor mode="full" value={rules} onChange={setRules} disabled={pending} />
      <p className="text-xs text-ink-faint">
        Saving on a date that already has a version replaces that version. Any other date adds a new one.
      </p>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line-strong bg-bg px-4 py-2 text-sm">
          Close
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save Change"}
        </button>
      </div>
    </div>
  );
}
