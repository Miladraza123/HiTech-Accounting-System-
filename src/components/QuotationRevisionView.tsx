import type { Tables } from "@/lib/supabase/database.types";

export function QuotationRevisionView({
  revision,
  lines,
}: {
  revision: Tables<"quotation_revisions">;
  lines: Tables<"quotation_lines">[];
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-left px-3 py-2">Unit</th>
                <th className="text-right px-3 py-2">Rate</th>
                <th className="text-right px-3 py-2">Tax %</th>
                <th className="text-right px-3 py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-3 py-2 text-ink">{l.description}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{l.qty}</td>
                  <td className="px-3 py-2 text-ink-soft">{l.unit ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{l.rate}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{l.tax_pct}%</td>
                  <td className="px-3 py-2 text-right tabular text-ink">{l.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-6 border-t border-line px-4 py-3 text-sm tabular">
          <span className="text-ink-soft">Subtotal: {revision.subtotal}</span>
          <span className="text-ink-soft">Tax: {revision.tax_total}</span>
          <span className="font-semibold text-ink">Total: {revision.grand_total}</span>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5 grid grid-cols-2 gap-4 text-sm">
        <Field label="Validity Date" value={revision.validity_date ?? "—"} />
        <Field label="Delivery Terms" value={revision.delivery_terms ?? "—"} />
        <Field label="Payment Terms" value={revision.payment_terms ?? "—"} />
        {revision.reason && <Field label="Revision Reason" value={revision.reason} />}
        {revision.terms && (
          <div className="col-span-2">
            <p className="text-xs text-ink-faint mb-1">Terms &amp; Conditions</p>
            <p className="text-ink whitespace-pre-wrap">{revision.terms}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="text-ink">{value}</p>
    </div>
  );
}
