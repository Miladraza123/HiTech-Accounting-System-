"use client";

import {
  EARLY_MODE_LABELS,
  LATE_MODE_LABELS,
  PAY_CYCLE_LABELS,
  RULE_LABELS,
  WEEKDAYS,
  formatRuleValue,
  paidShiftMinutes,
  ruleSetProblems,
  shiftMinutes,
  type HrRules,
  type RuleKey,
} from "@/lib/hrRules";

type Section = { title: string; keys: RuleKey[] };

const SECTIONS: Section[] = [
  { title: "Timing", keys: ["shift_start", "shift_end", "working_days", "break_minutes", "break_paid"] },
  {
    title: "Late arrival & early leaving",
    keys: [
      "late_grace_minutes",
      "late_mode",
      "late_count_per_deduction",
      "late_deduction_days",
      "half_day_late_after_minutes",
      "early_grace_minutes",
      "early_mode",
    ],
  },
  { title: "Short days", keys: ["half_day_below_minutes", "absent_below_minutes"] },
  { title: "Overtime", keys: ["ot_enabled", "ot_min_minutes", "ot_rate_type", "ot_rate"] },
  { title: "Leaves & pay", keys: ["sandwich_rule", "paid_leaves_per_year", "wager_pay_cycle", "wager_week_start"] },
];

const HINTS: Partial<Record<RuleKey, string>> = {
  shift_end: "Earlier than the start = night shift",
  late_grace_minutes: "Coming this late is not counted as late",
  half_day_late_after_minutes: "0 = off",
  half_day_below_minutes: "0 = off",
  absent_below_minutes: "0 = off",
  sandwich_rule: "An off day or holiday between two absences is also counted as absent",
  paid_leaves_per_year: "For permanent staff, in half days",
};

/** Whether a rule matters given the other values (hidden otherwise). */
function isRelevant(key: RuleKey, r: HrRules): boolean {
  switch (key) {
    case "late_count_per_deduction":
    case "late_deduction_days":
      return r.late_mode === "count";
    case "early_grace_minutes":
      return r.early_mode !== "none";
    case "ot_min_minutes":
    case "ot_rate_type":
    case "ot_rate":
      return r.ot_enabled;
    case "wager_week_start":
      return r.wager_pay_cycle !== "monthly";
    default:
      return true;
  }
}

function RuleInput({
  name,
  value,
  rules,
  disabled,
  onChange,
}: {
  name: RuleKey;
  value: HrRules[RuleKey];
  rules: HrRules;
  disabled?: boolean;
  onChange: (v: HrRules[RuleKey]) => void;
}) {
  const id = `rule-${name}`;
  switch (name) {
    case "shift_start":
    case "shift_end":
      return (
        <input id={id} type="time" value={value as string} disabled={disabled} required onChange={(e) => onChange(e.target.value)} className="input" />
      );
    case "working_days": {
      const days = value as number[];
      return (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Working days">
          {WEEKDAYS.map((label, d) => {
            const on = days.includes(d);
            return (
              <button
                key={label}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => onChange(on ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b))}
                className={`rounded-md border px-2.5 py-1 text-xs transition disabled:opacity-60 ${
                  on ? "border-accent bg-accent text-white" : "border-line-strong bg-bg text-ink-soft"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      );
    }
    case "break_paid":
    case "ot_enabled":
    case "sandwich_rule":
      return (
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <input id={id} type="checkbox" checked={value as boolean} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
          {value ? "On" : "Off"}
        </label>
      );
    case "late_mode":
      return (
        <select id={id} value={value as string} disabled={disabled} onChange={(e) => onChange(e.target.value as HrRules["late_mode"])} className="input">
          {Object.entries(LATE_MODE_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      );
    case "early_mode":
      return (
        <select id={id} value={value as string} disabled={disabled} onChange={(e) => onChange(e.target.value as HrRules["early_mode"])} className="input">
          {Object.entries(EARLY_MODE_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      );
    case "ot_rate_type":
      return (
        <select id={id} value={value as string} disabled={disabled} onChange={(e) => onChange(e.target.value as HrRules["ot_rate_type"])} className="input">
          <option value="multiplier">Times the normal rate (e.g. 1.5×)</option>
          <option value="fixed_per_hour">Fixed rupees per hour</option>
        </select>
      );
    case "wager_pay_cycle":
      return (
        <select id={id} value={value as string} disabled={disabled} onChange={(e) => onChange(e.target.value as HrRules["wager_pay_cycle"])} className="input">
          {Object.entries(PAY_CYCLE_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      );
    case "wager_week_start":
      return (
        <select id={id} value={String(value)} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="input">
          {WEEKDAYS.map((l, d) => (
            <option key={l} value={d}>
              {l}
            </option>
          ))}
        </select>
      );
    default: {
      const step = name === "ot_rate" ? "0.01" : name === "late_deduction_days" ? "0.25" : name === "paid_leaves_per_year" ? "0.5" : "1";
      const min = name === "late_count_per_deduction" ? 1 : name === "late_deduction_days" || name === "ot_rate" ? step : 0;
      return (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            step={step}
            min={min}
            value={Number.isFinite(value as number) ? String(value) : ""}
            disabled={disabled}
            required
            onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
            className="input"
          />
          {name === "ot_rate" && <span className="text-xs text-ink-faint whitespace-nowrap">{rules.ot_rate_type === "multiplier" ? "×" : "Rs/hour"}</span>}
        </div>
      );
    }
  }
}

/**
 * Editor for a whole rule set (a policy group version), or — with `base`
 * given — for one employee's overrides: each rule then has an "Own value"
 * tick, and unticked rules show (greyed) what the group gives.
 */
export function PolicyRulesEditor(
  props:
    | { mode: "full"; value: HrRules; onChange: (r: HrRules) => void; disabled?: boolean }
    | {
        mode: "override";
        base: HrRules;
        value: Partial<HrRules>;
        onChange: (r: Partial<HrRules>) => void;
        disabled?: boolean;
      }
) {
  const merged: HrRules = props.mode === "full" ? props.value : { ...props.base, ...props.value };
  const problems = ruleSetProblems(merged);
  const shift = shiftMinutes(merged);

  function setValue(key: RuleKey, v: HrRules[RuleKey]) {
    if (props.mode === "full") props.onChange({ ...props.value, [key]: v });
    else props.onChange({ ...props.value, [key]: v });
  }

  function toggleOverride(key: RuleKey, on: boolean) {
    if (props.mode !== "override") return;
    const next = { ...props.value };
    if (on) (next as Record<string, unknown>)[key] = props.base[key];
    else delete (next as Record<string, unknown>)[key];
    props.onChange(next);
  }

  return (
    <div className="space-y-4">
      {SECTIONS.map((section) => {
        const keys = section.keys.filter((k) => isRelevant(k, merged) || (props.mode === "override" && k in props.value));
        if (!keys.length) return null;
        return (
          <fieldset key={section.title} className="rounded-lg border border-line p-3 sm:p-4">
            <legend className="px-1 text-xs font-mono uppercase tracking-wide text-ink-faint">{section.title}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              {keys.map((key) => {
                const overridden = props.mode === "override" && key in props.value;
                const editable = props.mode === "full" || overridden;
                const label =
                  key === "ot_rate" ? (merged.ot_rate_type === "multiplier" ? "Overtime rate (× normal)" : "Overtime rate (Rs per hour)") : RULE_LABELS[key];
                return (
                  <div key={key} className={`space-y-1.5 ${key === "working_days" ? "sm:col-span-2" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor={`rule-${key}`} className="text-xs font-medium text-ink-soft">
                        {label}
                      </label>
                      {props.mode === "override" && (
                        <label className="inline-flex items-center gap-1 text-[11px] text-ink-faint">
                          <input
                            type="checkbox"
                            checked={overridden}
                            disabled={props.disabled}
                            onChange={(e) => toggleOverride(key, e.target.checked)}
                          />
                          Own value
                        </label>
                      )}
                    </div>
                    {editable ? (
                      <RuleInput name={key} value={merged[key]} rules={merged} disabled={props.disabled} onChange={(v) => setValue(key, v)} />
                    ) : (
                      <p className="rounded-md border border-dashed border-line px-3 py-1.5 text-sm text-ink-faint">
                        {formatRuleValue(key, props.mode === "override" ? props.base : merged)} <span className="text-[11px]">(group)</span>
                      </p>
                    )}
                    {HINTS[key] && editable && <p className="text-[11px] text-ink-faint">{HINTS[key]}</p>}
                  </div>
                );
              })}
            </div>
            {section.title === "Timing" && shift > 0 && (
              <p className="mt-3 text-xs text-ink-soft">
                Shift {Math.floor(shift / 60)}h {shift % 60}m · paid time in a full day {Math.floor(paidShiftMinutes(merged) / 60)}h{" "}
                {paidShiftMinutes(merged) % 60}m
              </p>
            )}
          </fieldset>
        );
      })}
      {problems.length > 0 && (
        <ul className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn list-disc list-inside">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** True when a number box was left empty (NaN would reach the database as null). */
export function hasBlankNumber(rules: Partial<HrRules>): boolean {
  return Object.values(rules).some((v) => typeof v === "number" && !Number.isFinite(v));
}

