"use client";

import { useState } from "react";
import type { TermsInput } from "@/app/actions/hr";
import type { HrRules } from "@/lib/hrRules";
import { PolicyRulesEditor } from "@/components/PolicyRulesEditor";

export type PolicyGroupOption = { id: string; name: string; rules: HrRules };

export type TermsDraft = {
  policy_group_id: string;
  employee_type: "permanent" | "daily_wager";
  monthly_salary: string;
  wage_basis: "per_day" | "per_minute";
  wage_rate: string;
  rule_overrides: Partial<HrRules>;
};

export function emptyTerms(groupId = ""): TermsDraft {
  return { policy_group_id: groupId, employee_type: "permanent", monthly_salary: "", wage_basis: "per_day", wage_rate: "", rule_overrides: {} };
}

/** Turns the form draft into the action's input, or an error message. */
export function termsFromDraft(d: TermsDraft): TermsInput | string {
  if (!d.policy_group_id) return "Pick a policy group.";
  if (d.employee_type === "permanent") {
    const salary = Number(d.monthly_salary);
    if (d.monthly_salary.trim() === "" || !Number.isFinite(salary) || salary < 0) return "Enter the monthly salary.";
    return { policy_group_id: d.policy_group_id, employee_type: "permanent", monthly_salary: salary, wage_basis: null, wage_rate: null, rule_overrides: d.rule_overrides };
  }
  const rate = Number(d.wage_rate);
  if (!Number.isFinite(rate) || rate <= 0) return "Enter the wage rate (more than 0).";
  return { policy_group_id: d.policy_group_id, employee_type: "daily_wager", monthly_salary: null, wage_basis: d.wage_basis, wage_rate: rate, rule_overrides: d.rule_overrides };
}

export function EmployeeTermsFields({
  groups,
  value,
  onChange,
  disabled,
}: {
  groups: PolicyGroupOption[];
  value: TermsDraft;
  onChange: (d: TermsDraft) => void;
  disabled?: boolean;
}) {
  const group = groups.find((g) => g.id === value.policy_group_id);
  const overrideCount = Object.keys(value.rule_overrides).length;
  const [showOverrides, setShowOverrides] = useState(overrideCount > 0);
  const set = (patch: Partial<TermsDraft>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Policy group *</span>
          <select value={value.policy_group_id} disabled={disabled} onChange={(e) => set({ policy_group_id: e.target.value })} className="input">
            <option value="">— Select —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Employee type *</span>
          <div className="flex gap-4 pt-1.5">
            {(
              [
                ["permanent", "Permanent (monthly salary)"],
                ["daily_wager", "Daily wager"],
              ] as const
            ).map(([v, l]) => (
              <label key={v} className="inline-flex items-center gap-2 text-sm text-ink">
                <input type="radio" name="employee_type" checked={value.employee_type === v} disabled={disabled} onChange={() => set({ employee_type: v })} />
                {l}
              </label>
            ))}
          </div>
        </div>
      </div>

      {value.employee_type === "permanent" ? (
        <label className="block space-y-1.5 sm:max-w-xs">
          <span className="text-xs font-medium text-ink-soft">Monthly salary (Rs) *</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={value.monthly_salary}
            disabled={disabled}
            onChange={(e) => set({ monthly_salary: e.target.value })}
            className="input"
          />
          <span className="block text-[11px] text-ink-faint">Per-day pay = salary ÷ working days of that month.</span>
        </label>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Paid *</span>
            <select
              value={value.wage_basis}
              disabled={disabled}
              onChange={(e) => set({ wage_basis: e.target.value as TermsDraft["wage_basis"] })}
              className="input"
            >
              <option value="per_day">Per day</option>
              <option value="per_minute">Per minute worked</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">{value.wage_basis === "per_day" ? "Rate per day (Rs) *" : "Rate per minute (Rs) *"}</span>
            <input
              type="number"
              min="0"
              step="0.0001"
              inputMode="decimal"
              value={value.wage_rate}
              disabled={disabled}
              onChange={(e) => set({ wage_rate: e.target.value })}
              className="input"
            />
          </label>
        </div>
      )}

      {group && (
        <div className="space-y-3">
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={showOverrides}
              disabled={disabled}
              onChange={(e) => {
                setShowOverrides(e.target.checked);
                if (!e.target.checked) set({ rule_overrides: {} });
              }}
            />
            Different rules for this employee{overrideCount > 0 ? ` (${overrideCount} set)` : ""}
          </label>
          {showOverrides && (
            <PolicyRulesEditor
              mode="override"
              base={group.rules}
              value={value.rule_overrides}
              onChange={(o) => set({ rule_overrides: o })}
              disabled={disabled}
            />
          )}
        </div>
      )}
    </div>
  );
}
