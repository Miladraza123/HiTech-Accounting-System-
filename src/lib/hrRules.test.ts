import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_RULES, asOverrides, asRules, paidShiftMinutes, ruleSetProblems, shiftMinutes, summarizeRules } from "./hrRules";

describe("hrRules", () => {
  it("DEFAULT_RULES matches fn_hr_default_rules() in the migration", () => {
    const sql = readFileSync(
      join(__dirname, "../../supabase/migrations/20261009100000_phase47_06_paid_leaves_per_month.sql"),
      "utf8"
    ).toLowerCase();
    const body = sql.slice(sql.indexOf("function public.fn_hr_default_rules()"), sql.indexOf("function public.fn_hr_validate_rules"));
    for (const [key, value] of Object.entries(DEFAULT_RULES)) {
      const literal = Array.isArray(value)
        ? `jsonb_build_array(${value.join(", ")})`
        : typeof value === "string"
          ? `'${value}'`
          : String(value);
      expect(body, key).toContain(`'${key}', ${literal}`.toLowerCase());
    }
  });

  it("works out shift length, including a night shift", () => {
    expect(shiftMinutes({ shift_start: "09:00", shift_end: "18:00" })).toBe(540);
    expect(shiftMinutes({ shift_start: "22:00", shift_end: "06:00" })).toBe(480);
    expect(paidShiftMinutes(DEFAULT_RULES)).toBe(480);
    expect(paidShiftMinutes({ ...DEFAULT_RULES, break_paid: true })).toBe(540);
  });

  it("flags the same problems the database refuses", () => {
    expect(ruleSetProblems(DEFAULT_RULES)).toEqual([]);
    expect(ruleSetProblems({ ...DEFAULT_RULES, shift_end: "09:00" })[0]).toMatch(/same time/);
    expect(ruleSetProblems({ ...DEFAULT_RULES, shift_end: "10:00" })[0]).toMatch(/shorter than the shift/);
    expect(ruleSetProblems({ ...DEFAULT_RULES, absent_below_minutes: 300 })[0]).toMatch(/cannot be more than/);
  });

  it("keeps only known keys in overrides and fills full sets", () => {
    expect(asOverrides({ shift_start: "10:00", foo: 1 })).toEqual({ shift_start: "10:00" });
    expect(asRules({ ot_rate: 2 }).ot_rate).toBe(2);
    expect(asRules(null)).toEqual(DEFAULT_RULES);
    expect(summarizeRules(DEFAULT_RULES)[0]).toContain("09:00–18:00");
  });
});
