import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canReadHr } from "@/lib/hrAccess";
import { buildExcelResponse } from "@/lib/excelExport";
import { isMonth, monthRange } from "@/lib/hrMonth";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!canReadHr(user)) return new Response("Forbidden", { status: 403 });
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!isMonth(month)) return new Response("Bad month", { status: 400 });
  const { from, to } = monthRange(month);
  const dayCount = Number(to.slice(8));

  const supabase = await createClient();
  const [{ data: rows, error }, { data: employees }] = await Promise.all([
    supabase.rpc("fn_hr_register", { p_month: from }),
    supabase.from("hr_employees").select("id, code, full_name, designation"),
  ]);
  if (error) return new Response(`Export failed: ${error.message}`, { status: 500 });
  const byId = new Map((employees ?? []).map((e) => [e.id, e]));

  const out = (rows ?? [])
    .map((r) => {
      const e = byId.get(r.employee_id);
      const row: Record<string, unknown> = { code: e?.code, name: e?.full_name, designation: e?.designation ?? "" };
      (r.codes as string[]).forEach((c, i) => (row[`d${i + 1}`] = c));
      row.present = Number(r.present);
      row.half_days = r.half_days;
      row.absent = Number(r.absent);
      row.leave = Number(r.leave);
      row.lates = r.lates;
      row.not_entered = r.not_entered;
      row.worked_hours = Math.round((r.worked_minutes / 60) * 100) / 100;
      row.ot_hours = Math.round((r.ot_minutes / 60) * 100) / 100;
      return row;
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return buildExcelResponse(
    `Attendance ${month}`,
    [
      { header: "Code", key: "code", width: 10 },
      { header: "Employee", key: "name", width: 26 },
      { header: "Designation", key: "designation", width: 16 },
      ...Array.from({ length: dayCount }, (_, i) => ({ header: String(i + 1), key: `d${i + 1}`, width: 4 })),
      { header: "Present", key: "present", width: 9 },
      { header: "Half Days", key: "half_days", width: 9 },
      { header: "Absent", key: "absent", width: 9 },
      { header: "Leave", key: "leave", width: 9 },
      { header: "Lates", key: "lates", width: 8 },
      { header: "Not Entered", key: "not_entered", width: 11 },
      { header: "Worked Hours", key: "worked_hours", width: 12 },
      { header: "OT Hours", key: "ot_hours", width: 10 },
    ],
    out,
    `attendance-${month}.xlsx`
  );
}
