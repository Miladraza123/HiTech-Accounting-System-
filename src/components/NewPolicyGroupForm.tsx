"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPolicyGroupAction } from "@/app/actions/hr";
import { DEFAULT_RULES, ruleSetProblems, type HrRules } from "@/lib/hrRules";
import { PolicyRulesEditor, hasBlankNumber } from "@/components/PolicyRulesEditor";
import { EffectiveDateField } from "@/components/EffectiveDateField";

export function NewPolicyGroupForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<HrRules>(DEFAULT_RULES);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition"
      >
        + New Policy Group
      </button>
    );
  }

  function submit() {
    setError(null);
    if (!name.trim()) return setError("Group name is required.");
    if (!effectiveFrom) return setError("Choose the date this policy starts from.");
    if (hasBlankNumber(rules)) return setError("Fill every number box.");
    const problems = ruleSetProblems(rules);
    if (problems.length) return setError(problems[0]);
    startTransition(async () => {
      const res = await createPolicyGroupAction({ name, description, rules, effective_from: effectiveFrom });
      if (res.error) return setError(res.error);
      router.push(`/hr/policies/${res.id}`);
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 sm:p-5 space-y-4">
      <h2 className="text-sm font-semibold text-ink">New Policy Group</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Group name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="e.g. Factory Shift A / Office Staff" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" />
        </label>
      </div>
      <EffectiveDateField value={effectiveFrom} onChange={setEffectiveFrom} />
      <PolicyRulesEditor mode="full" value={rules} onChange={setRules} disabled={pending} />
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
          {pending ? "Saving…" : "Create Group"}
        </button>
      </div>
    </div>
  );
}
