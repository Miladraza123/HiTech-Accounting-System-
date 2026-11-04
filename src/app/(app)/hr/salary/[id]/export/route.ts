import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canReadHr } from "@/lib/hrAccess";
import { buildExcelResponse } from "@/lib/excelExport";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!canReadHr(user)) return new Response("Forbidden", { status: 403 });
  const { id } = await params;

  const supabase = await createClient();
  const [{ data: sheet }, { data: lines, error }] = await Promise.all([
    supabase.from("hr_salary_sheets").select("sheet_no, period_from, period_to, status").eq("id", id).maybeSingle(),
    supabase.from("hr_salary_lines").select("*, hr_employees(code, full_name, designation)").eq("sheet_id", id),
  ]);
  const lineIds = (lines ?? []).map((l) => l.id);
  const { data: lineCharges } = lineIds.length ? await supabase.from("hr_salary_line_charges").select("line_id, name, amount").in("line_id", lineIds).order("created_at") : { data: [] };
  const chargeText = new Map<string, string>();
  for (const c of lineCharges ?? []) {
    if (Number(c.amount) <= 0) continue;
    chargeText.set(c.line_id, [chargeText.get(c.line_id), `${c.name} ${Number(c.amount)}`].filter(Boolean).join(", "));
  }
  if (error) return new Response(`Export failed: ${error.message}`, { status: 500 });
  if (!sheet) return new Response("Not found", { status: 404 });

  type Emp = { code: string; full_name: string; designation: string | null };
  const rows = (lines ?? [])
    .map((l) => {
      const e = l.hr_employees as unknown as Emp;
      return {
        code: e.code,
        name: e.full_name,
        designation: e.designation ?? "",
        type: l.employee_type === "permanent" ? "Permanent" : "Daily wager",
        rate: Number(l.rate),
        working_days: Number(l.working_days),
        present: Number(l.present_days),
        absent: Number(l.absent_days),
        paid_leave: Number(l.paid_leave_days),
        unpaid_leave: Number(l.unpaid_leave_days),
        lates: l.late_count,
        ot_hours: Math.round((l.ot_minutes / 60) * 100) / 100,
        base: Number(l.base_pay),
        ot_pay: Number(l.ot_pay),
        late_cut: Number(l.late_deduction),
        early_cut: Number(l.early_deduction),
        sandwich_cut: Number(l.sandwich_deduction),
        bonus: Number(l.bonus),
        other_cut: Number(l.other_deduction),
        fixed_charges: Number(l.fixed_charges_total),
        fixed_detail: chargeText.get(l.id) ?? "",
        gross: Number(l.gross),
        advance: Number(l.advance_recovery),
        net: Number(l.net),
        note: l.adjustment_note ?? "",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return buildExcelResponse(
    `${sheet.sheet_no} ${sheet.status}`.slice(0, 31),
    [
      { header: "Code", key: "code" },
      { header: "Employee", key: "name", width: 28 },
      { header: "Designation", key: "designation", width: 18 },
      { header: "Type", key: "type" },
      { header: "Rate", key: "rate" },
      { header: "Working Days", key: "working_days" },
      { header: "Present", key: "present" },
      { header: "Absent", key: "absent" },
      { header: "Paid Leave", key: "paid_leave" },
      { header: "Unpaid Leave", key: "unpaid_leave" },
      { header: "Lates", key: "lates" },
      { header: "OT Hours", key: "ot_hours" },
      { header: "Base Pay", key: "base" },
      { header: "OT Pay", key: "ot_pay" },
      { header: "Late Cut", key: "late_cut" },
      { header: "Early Cut", key: "early_cut" },
      { header: "Sandwich Cut", key: "sandwich_cut" },
      { header: "Bonus", key: "bonus" },
      { header: "Other Cut", key: "other_cut" },
      { header: "Fixed Charges", key: "fixed_charges" },
      { header: "Fixed Charges Detail", key: "fixed_detail", width: 28 },
      { header: "Gross", key: "gross" },
      { header: "Advance Recovered", key: "advance" },
      { header: "Net Pay", key: "net" },
      { header: "Note", key: "note", width: 30 },
    ],
    rows,
    `${sheet.sheet_no}.xlsx`
  );
}
