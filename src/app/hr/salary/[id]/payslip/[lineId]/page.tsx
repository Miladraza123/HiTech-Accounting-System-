import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import { EMPLOYEE_TYPE_LABELS } from "@/lib/hrRules";
import { STATUS_LABELS, minutesLabel, type DayStatus } from "@/lib/hrDayCalc";
import { days, money, sheetLabel, type SalaryDay } from "@/lib/hrSalary";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ lineId: string }> }): Promise<Metadata> {
  const { lineId } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("hr_salary_lines").select("hr_employees(full_name), hr_salary_sheets(sheet_no)").eq("id", lineId).maybeSingle();
  const e = data?.hr_employees as unknown as { full_name: string } | null;
  const s = data?.hr_salary_sheets as unknown as { sheet_no: string } | null;
  return { title: e && s ? `Payslip ${e.full_name} ${s.sheet_no}` : "Payslip" };
}

export default async function PayslipPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; lineId: string }>;
  searchParams: Promise<{ autoprint?: string }>;
}) {
  const { id, lineId } = await params;
  const { autoprint } = await searchParams;
  const supabase = await createClient();
  const [{ data: line }, { data: company }] = await Promise.all([
    supabase.from("hr_salary_lines").select("*, hr_employees(code, full_name, father_name, cnic, designation, department), hr_salary_sheets(*)").eq("id", lineId).eq("sheet_id", id).maybeSingle(),
    supabase.from("company").select("*").maybeSingle(),
  ]);
  if (!line) notFound();
  const { logoUrl } = await getCompanyBrandingUrls(supabase, company, { signature: false, stamp: false });
  const emp = line.hr_employees as unknown as {
    code: string;
    full_name: string;
    father_name: string | null;
    cnic: string | null;
    designation: string | null;
    department: string | null;
  };
  const sheet = line.hr_salary_sheets as unknown as {
    sheet_no: string;
    kind: string;
    wager_cycle: string | null;
    period_from: string;
    period_to: string;
    status: string;
    paid_on: string | null;
  };
  const dayRows = (line.days as unknown as SalaryDay[]) ?? [];

  const earnings: [string, number][] = [
    ["Basic pay (days worked + paid leave)", Number(line.base_pay)],
    [`Overtime (${minutesLabel(line.ot_minutes)})`, Number(line.ot_pay)],
    ["Bonus", Number(line.bonus)],
  ];
  const deductions: [string, number][] = [
    [`Late arrival (${line.late_count} lates)`, Number(line.late_deduction)],
    ["Early leaving", Number(line.early_deduction)],
    [`Sandwich rule (${line.sandwich_days} day)`, Number(line.sandwich_deduction)],
    ["Other deduction", Number(line.other_deduction)],
    ["Advance recovered", Number(line.advance_recovery)],
  ];

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/hr/salary/${id}`} />}
      <div className="print-payslip">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-payslip") }} />
        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={false} showEmail={false} />
          <div style={{ textAlign: "right" }}>
            <h1>PAYSLIP</h1>
            <div className="muted">{sheet.sheet_no}</div>
            <div className="muted">
              {sheet.period_from} to {sheet.period_to}
            </div>
            {sheet.status !== "Paid" && sheet.status !== "Finalized" && <div className="muted">{sheet.status.toUpperCase()} — not final</div>}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <div>
            <div style={{ fontWeight: 600 }}>
              {emp.full_name} ({emp.code})
            </div>
            {emp.father_name && <div className="muted">S/o {emp.father_name}</div>}
            {emp.cnic && <div className="muted">CNIC {emp.cnic}</div>}
            <div className="muted">
              {[emp.designation, emp.department].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted">{sheetLabel(sheet)}</div>
            <div className="muted">{EMPLOYEE_TYPE_LABELS[line.employee_type]}</div>
            <div className="muted">
              {line.pay_basis === "monthly" ? `${money(line.rate)} / month` : line.pay_basis === "per_day" ? `${money(line.rate)} / day` : `Rs ${Number(line.rate)} / minute`}
            </div>
            {sheet.paid_on && <div className="muted">Paid on {sheet.paid_on}</div>}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Working days</th>
              <th className="num">Present</th>
              <th className="num">Absent</th>
              <th className="num">Paid leave</th>
              <th className="num">Unpaid leave</th>
              <th className="num">Lates</th>
              <th className="num">Overtime</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{days(line.working_days)}</td>
              <td className="num">{days(line.present_days)}</td>
              <td className="num">{days(line.absent_days)}</td>
              <td className="num">{days(line.paid_leave_days)}</td>
              <td className="num">{days(line.unpaid_leave_days)}</td>
              <td className="num">{line.late_count}</td>
              <td className="num">{minutesLabel(line.ot_minutes)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ display: "flex", gap: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Earnings</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {earnings.map(([l, v]) => (
                <tr key={l}>
                  <td>{l}</td>
                  <td className="num">{money(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>Deductions</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {deductions.map(([l, v]) => (
                <tr key={l}>
                  <td>{l}</td>
                  <td className="num">{money(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {line.adjustment_note && <p className="muted">Note: {line.adjustment_note}</p>}
        <div className="totals">
          <span>Gross {money(line.gross)}</span>
          <span className="grand">Net pay {money(line.net)}</span>
        </div>

        <table style={{ fontSize: 10 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Day</th>
              <th className="num">Worked</th>
              <th className="num">Late</th>
              <th className="num">Early</th>
              <th className="num">OT</th>
              <th className="num">Pay</th>
            </tr>
          </thead>
          <tbody>
            {dayRows.map((d) => (
              <tr key={d.d}>
                <td>{d.d}</td>
                <td>
                  {STATUS_LABELS[d.s as DayStatus] ?? d.s}
                  {d.pl > 0 && " (paid)"}
                  {d.sw && " · sandwich"}
                </td>
                <td className="num">{d.net ? minutesLabel(d.net) : ""}</td>
                <td className="num">{d.late ? minutesLabel(d.late) : ""}</td>
                <td className="num">{d.early ? minutesLabel(d.early) : ""}</td>
                <td className="num">{d.ot ? minutesLabel(d.ot) : ""}</td>
                <td className="num">{d.pay || d.otpay ? money(d.pay + d.otpay) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <PrintSignoff ourLabel="Prepared By" theirLabel="Received By (Signature & Date)" signatureUrl={null} stampUrl={null} />
        <PrintFooter />
        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
