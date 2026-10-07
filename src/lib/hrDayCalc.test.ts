import { describe, expect, it } from "vitest";
import fixtures from "./hrDayCalc.fixtures.json";
import { calcDay, type DayKind, type Mark, type Pair } from "./hrDayCalc";
import { DEFAULT_RULES, type HrRules } from "./hrRules";

type Fixture = {
  name: string;
  rules: Partial<HrRules>;
  kind: DayKind;
  mark: Mark;
  pairs: Pair[];
  lf: number | null;
  expect: Record<string, unknown>;
};

describe("calcDay fixtures (same file is checked against fn_hr_calc_day)", () => {
  for (const f of fixtures as Fixture[]) {
    it(f.name, () => {
      const got = calcDay({ ...DEFAULT_RULES, ...f.rules }, f.kind, f.mark, f.pairs, f.lf) as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(f.expect)) expect(got[k], k).toEqual(v);
    });
  }
});
