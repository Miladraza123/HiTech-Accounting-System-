"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEmployeeAction, updateEmployeeAction, type EmployeeDetailsInput } from "@/app/actions/hr";
import { karachiToday } from "@/lib/karachiTime";
import { hasBlankNumber } from "@/components/PolicyRulesEditor";
import { EmployeeTermsFields, emptyTerms, termsFromDraft, type PolicyGroupOption, type TermsDraft } from "@/components/EmployeeTermsFields";
import { ruleSetProblems } from "@/lib/hrRules";

const FIELDS: { key: keyof EmployeeDetailsInput; label: string; placeholder?: string; type?: string }[] = [
  { key: "full_name", label: "Full name *" },
  { key: "father_name", label: "Father's name" },
  { key: "cnic", label: "CNIC", placeholder: "12345-1234567-1" },
  { key: "phone", label: "Phone", placeholder: "03xx-xxxxxxx" },
  { key: "designation", label: "Designation", placeholder: "e.g. Welder / Helper / Clerk" },
  { key: "department", label: "Department", placeholder: "e.g. Fabrication" },
];

function emptyDetails(): EmployeeDetailsInput {
  return { code: "", full_name: "", father_name: "", cnic: "", phone: "", address: "", designation: "", department: "", join_date: karachiToday(), notes: "" };
}

/** New employee (details + first terms), or editing an existing employee's details only. */
export function EmployeeForm(
  props:
    | { mode: "create"; groups: PolicyGroupOption[] }
    | { mode: "edit"; employeeId: string; initial: EmployeeDetailsInput }
) {
  const router = useRouter();
  const [details, setDetails] = useState<EmployeeDetailsInput>(props.mode === "edit" ? props.initial : emptyDetails());
  const [terms, setTerms] = useState<TermsDraft>(emptyTerms(props.mode === "create" && props.groups.length === 1 ? props.groups[0].id : ""));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof EmployeeDetailsInput, v: string) => setDetails((d) => ({ ...d, [k]: v }));

  function submit() {
    setError(null);
    setSaved(false);
    if (!details.full_name.trim()) return setError("Employee name is required.");
    if (!details.join_date) return setError("Joining date is required.");
    if (props.mode === "edit") {
      if (!details.code.trim()) return setError("Employee code is required.");
      startTransition(async () => {
        const res = await updateEmployeeAction(props.employeeId, details);
        if (res.error) return setError(res.error);
        setSaved(true);
        router.refresh();
      });
      return;
    }
    const t = termsFromDraft(terms);
    if (typeof t === "string") return setError(t);
    if (hasBlankNumber(t.rule_overrides)) return setError("Fill every number box in this employee's own rules.");
    const group = props.groups.find((g) => g.id === t.policy_group_id);
    if (group) {
      const problems = ruleSetProblems({ ...group.rules, ...t.rule_overrides });
      if (problems.length) return setError(problems[0]);
    }
    startTransition(async () => {
      const res = await createEmployeeAction({ ...details, ...t });
      if (res.error) return setError(res.error);
      router.push(`/hr/employees/${res.id}`);
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 sm:p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Employee code{props.mode === "edit" ? " *" : ""}</span>
          <input
            value={details.code}
            onChange={(e) => set("code", e.target.value)}
            className="input font-mono"
            placeholder={props.mode === "create" ? "Auto (EMP-0001)" : undefined}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Joining date *</span>
          <input type="date" value={details.join_date} onChange={(e) => set("join_date", e.target.value)} className="input" />
          {props.mode === "create" && <span className="block text-[11px] text-ink-faint">The pay and rules below start from this date.</span>}
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FIELDS.map((f) => (
          <label key={f.key} className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">{f.label}</span>
            <input value={details[f.key]} onChange={(e) => set(f.key, e.target.value)} className="input" placeholder={f.placeholder} />
          </label>
        ))}
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Address</span>
        <input value={details.address} onChange={(e) => set("address", e.target.value)} className="input" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Notes</span>
        <textarea value={details.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="input resize-none" />
      </label>

      {props.mode === "create" && (
        <div className="space-y-3 border-t border-line pt-4">
          <h2 className="text-sm font-semibold text-ink">Pay & Attendance Rules</h2>
          {props.groups.length === 0 ? (
            <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">Create a policy group first (HR / Attendance → Attendance Policies).</p>
          ) : (
            <EmployeeTermsFields groups={props.groups} value={terms} onChange={setTerms} disabled={pending} />
          )}
        </div>
      )}

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      {saved && <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">Saved.</p>}
      <button
        type="button"
        onClick={submit}
        disabled={pending || (props.mode === "create" && props.groups.length === 0)}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : props.mode === "create" ? "Create Employee" : "Save Details"}
      </button>
    </div>
  );
}
