import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

function agingBucket(dueDate: string): "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus" {
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

type Buckets = { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
const emptyBuckets = (): Buckets => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });

export default async function ApAgingPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  const [{ data: outstanding }, { data: bills }, { data: parties }] = await Promise.all([
    supabase.from("supplier_bill_outstanding").select("*").gt("outstanding_amount", 0),
    supabase.from("supplier_bills").select("id, bill_date, supplier_id"),
    supabase.from("parties").select("id, legal_name, credit_days"),
  ]);

  const billById = new Map((bills ?? []).map((b) => [b.id, b]));
  const partyById = new Map((parties ?? []).map((p) => [p.id, p]));

  const perParty = new Map<string, Buckets>();
  for (const o of outstanding ?? []) {
    const bill = billById.get(o.supplier_bill_id!);
    const party = partyById.get(o.supplier_id!);
    if (!bill || !party) continue;
    const dueDate = new Date(bill.bill_date);
    dueDate.setDate(dueDate.getDate() + (party.credit_days ?? 0));
    const bucket = agingBucket(dueDate.toISOString().slice(0, 10));
    const rec = perParty.get(party.id) ?? emptyBuckets();
    rec[bucket] += o.outstanding_amount ?? 0;
    perParty.set(party.id, rec);
  }

  const rows = Array.from(perParty.entries())
    .map(([partyId, b]) => ({
      partyId,
      name: partyById.get(partyId)?.legal_name ?? "—",
      ...b,
      total: b.current + b.d1_30 + b.d31_60 + b.d61_90 + b.d90_plus,
    }))
    .sort((a, b) => b.total - a.total);

  const grand = rows.reduce(
    (acc, r) => ({
      current: acc.current + r.current,
      d1_30: acc.d1_30 + r.d1_30,
      d31_60: acc.d31_60 + r.d31_60,
      d61_90: acc.d61_90 + r.d61_90,
      d90_plus: acc.d90_plus + r.d90_plus,
      total: acc.total + r.total,
    }),
    { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 }
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">AP Aging — Supplier-wise Outstanding</h1>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Supplier</th>
                <th className="text-right px-3 py-2">Current</th>
                <th className="text-right px-3 py-2">1-30</th>
                <th className="text-right px-3 py-2">31-60</th>
                <th className="text-right px-3 py-2">61-90</th>
                <th className="text-right px-3 py-2">90+</th>
                <th className="text-right px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.partyId} className="border-t border-line">
                  <td className="px-3 py-2 text-ink">
                    <Link href={`/clients/${r.partyId}`} className="text-accent-ink underline underline-offset-2">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{r.current.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{r.d1_30.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right tabular ${r.d31_60 > 0 ? "text-warn" : "text-ink-soft"}`}>{r.d31_60.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right tabular ${r.d61_90 > 0 ? "text-warn" : "text-ink-soft"}`}>{r.d61_90.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right tabular ${r.d90_plus > 0 ? "text-bad font-medium" : "text-ink-soft"}`}>{r.d90_plus.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular text-ink font-medium">{r.total.toLocaleString()}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                    Koi outstanding supplier bill nahi hai.
                  </td>
                </tr>
              )}
            </tbody>
            {!!rows.length && (
              <tfoot>
                <tr className="border-t-2 border-line-strong bg-surface-2 font-semibold text-ink">
                  <td className="px-3 py-2 text-xs uppercase tracking-wide">Total</td>
                  <td className="px-3 py-2 text-right tabular">{grand.current.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular">{grand.d1_30.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular">{grand.d31_60.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular">{grand.d61_90.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular">{grand.d90_plus.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular">{grand.total.toLocaleString()}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
