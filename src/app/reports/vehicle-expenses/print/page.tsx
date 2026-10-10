import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Vehicle & Engineer/Rider Expense Report" };

export default async function VehicleExpensesPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { signature, stamp, phone, email, autoprint } = await searchParams;

  const supabase = await createClient();
  const [{ data: vehicleSummary }, { data: personSummary }, { data: company }] = await Promise.all([
    supabase.from("vehicle_expense_summary").select("*").order("total_expense", { ascending: false }),
    supabase.from("responsible_person_expense_summary").select("*").gt("expense_count", 0).order("total_expense", { ascending: false }),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  const highestVehicle = (vehicleSummary ?? [])[0];

  const totalFuel = (vehicleSummary ?? []).reduce((s, v) => s + (v.fuel_expense ?? 0), 0);
  const totalMaintenance = (vehicleSummary ?? []).reduce((s, v) => s + (v.maintenance_expense ?? 0), 0);
  const totalVehicleExpense = (vehicleSummary ?? []).reduce((s, v) => s + (v.total_expense ?? 0), 0);
  const totalPersonExpense = (personSummary ?? []).reduce((s, p) => s + (p.total_expense ?? 0), 0);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href="/reports/vehicle-expenses" />}
      <div className="print-ve">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-ve") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>VEHICLE &amp; ENGINEER/RIDER EXPENSE REPORT</h1>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        {highestVehicle && (highestVehicle.total_expense ?? 0) > 0 && (
          <div className="muted" style={{ marginBottom: 8 }}>
            Highest Expense Vehicle: {highestVehicle.vehicle_no} — {(highestVehicle.total_expense ?? 0).toLocaleString()}
          </div>
        )}

        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Status</th>
              <th className="num">Distance (KM)</th>
              <th className="num">Fuel</th>
              <th className="num">Maintenance</th>
              <th className="num">Total</th>
              <th className="num">Cost/KM</th>
            </tr>
          </thead>
          <tbody>
            {(vehicleSummary ?? []).map((v) => {
              const distance = (v.current_meter_reading ?? 0) - (v.opening_meter_reading ?? 0);
              const costPerKm = distance > 0 ? (v.total_expense ?? 0) / distance : null;
              return (
                <tr key={v.vehicle_id}>
                  <td>{v.vehicle_no}</td>
                  <td>{v.status}</td>
                  <td className="num">{distance.toLocaleString()}</td>
                  <td className="num">{(v.fuel_expense ?? 0).toLocaleString()}</td>
                  <td className="num">{(v.maintenance_expense ?? 0).toLocaleString()}</td>
                  <td className="num">{(v.total_expense ?? 0).toLocaleString()}</td>
                  <td className="num">{costPerKm !== null ? costPerKm.toFixed(2) : "—"}</td>
                </tr>
              );
            })}
            {!vehicleSummary?.length && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center" }}>
                  No vehicles created yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="totals">
          <span>Total Fuel: {totalFuel.toLocaleString()}</span>
          <span>Total Maintenance: {totalMaintenance.toLocaleString()}</span>
          <span className="grand">Total Vehicle Expense: {totalVehicleExpense.toLocaleString()}</span>
        </div>

        <div className="totals" style={{ marginTop: 20, marginBottom: 4 }}>
          <span style={{ fontWeight: 600 }}>Engineer / Rider-wise Expense</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th className="num"># Expenses</th>
              <th className="num">Pending Settlement</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {(personSummary ?? []).map((p) => (
              <tr key={p.user_id}>
                <td>{p.full_name}</td>
                <td className="num">{p.expense_count}</td>
                <td className="num">{(p.pending_settlement_count ?? 0) > 0 ? p.pending_settlement_count : 0}</td>
                <td className="num">{(p.total_expense ?? 0).toLocaleString()}</td>
              </tr>
            ))}
            {!personSummary?.length && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center" }}>
                  No person-linked expenses yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="totals">
          <span className="grand">Total Person Expense: {totalPersonExpense.toLocaleString()}</span>
        </div>

        <PrintSignoff ourLabel="Prepared By (Accounts)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
