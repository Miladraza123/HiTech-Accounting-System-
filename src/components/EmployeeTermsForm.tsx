"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setEmployeeTermsAction } from "@/app/actions/hr";
import { ruleSetProblems } from "@/lib/hrRules";
import { hasBlankNumber } from "@/components/PolicyRulesEditor";
import { EffectiveDateField } from "@/components/EffectiveDateField";
import { EmployeeTermsFields, termsFromDraft, type PolicyGroupOption, type TermsDraft } from "@/components/EmployeeTermsFields";

/** "Change pay / group / rules" — saved as new terms from the chosen date. */
export function EmployeeTermsForm({
  employeeId,
  groups,
  latest,
  joinDate,
  leaveDate,
}: {
  employeeId: string;
  groups: PolicyGroupOption[];
  latest: TermsDraft;
  joinDate: string;
  leaveDate: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TermsDraft>(latest);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(latest);
          setOpen(true);
        }}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition"
      >
        Change Pay / Group / Rules
      </button>
    );
  }

  function submit() {
    setError(null);
    if (!effectiveFrom) return setError("Choose the date this change starts from.");
    if (effectiveFrom < joinDate) return setError("The change cannot start before the joining date.");
    if (leaveDate && effectiveFrom > leaveDate) return setError("The change cannot start after the leaving date.");
    const t = termsFromDraft(draft);
    if (typeof t === "string") return setError(t);
    if (hasBlankNumber(t.rule_overrides)) return setError("Fill every number box in this employee's own rules.");
    const group = groups.find((g) => g.id === t.policy_group_id);
    if (group) {
      const problems = ruleSetProblems({ ...group.rules, ...t.rule_overrides });
      if (problems.length) return setError(problems[0]);
    }
    startTransition(async () => {
      const res = await setEmployeeTermsAction(employeeId, { ...t, effective_from: effectiveFrom, reason });
      if (res.error) return setError(res.error);
      setOpen(false);
      setEffectiveFrom("");
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-accent bg-surface p-4 sm:p-5 space-y-4">
      <h2 className="text-sm font-semibold text-ink">Change Pay / Group / Rules</h2>
      <EffectiveDateField value={effectiveFrom} onChange={setEffectiveFrom} min={joinDate} />
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Reason / note</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} className="input" placeholder="e.g. Annual increment / Made permanent" />
      </label>
      <EmployeeTermsFields groups={groups} value={draft} onChange={setDraft} disabled={pending} />
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
