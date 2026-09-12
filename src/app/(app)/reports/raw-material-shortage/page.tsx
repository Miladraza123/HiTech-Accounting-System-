import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

export default async function RawMaterialShortagePage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "store") || hasRole(user, "production") || hasRole(user, "accounts") || hasRole(user, "auditor")))
    redirect("/");

  const supabase = await createClient();
  const { data: requirements } = await supabase
    .from("job_material_requirements")
    .select("item_id, required_qty, reserved_qty, issued_qty, source, unit, items(item_code, description, base_unit), jobs!inner(job_no, status)")
    .eq("source", "stock")
    .eq("jobs.status", "MaterialPending");

  type ItemInfo = { item_code: string; description: string; base_unit: string } | null;
  type JobInfo = { job_no: string; status: string };

  const byItem = new Map<string, { item: ItemInfo; unit: string | null; shortfall: number; jobNos: Set<string> }>();
  for (const r of requirements ?? []) {
    const shortfall = r.required_qty - r.reserved_qty - r.issued_qty;
    if (shortfall <= 0.001) continue;
    const item = r.items as unknown as ItemInfo;
    const job = r.jobs as unknown as JobInfo;
    const rec = byItem.get(r.item_id) ?? { item, unit: r.unit, shortfall: 0, jobNos: new Set<string>() };
    rec.shortfall += shortfall;
    rec.jobNos.add(job.job_no);
    byItem.set(r.item_id, rec);
  }

  const rows = Array.from(byItem.entries())
    .map(([itemId, r]) => ({ itemId, ...r, jobList: Array.from(r.jobNos).join(", ") }))
    .sort((a, b) => b.shortfall - a.shortfall);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Raw Material Shortage</h1>
        <p className="text-sm text-ink-soft">
          Woh items jinki maujooda stock se kami ki wajah se Job(s) &quot;Material Pending&quot; par ruki hui hain — inhen khareedna zaroori hai.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <p className={`text-2xl font-semibold tabular ${rows.length > 0 ? "text-bad" : "text-ink"}`}>{rows.length}</p>
        <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Items Short</p>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-right px-3 py-2">Shortfall Qty</th>
                <th className="text-left px-3 py-2">Blocked Jobs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId} className="border-t border-line">
                  <td className="px-3 py-2 text-ink">
                    <Link href={`/items/${r.itemId}`} className="text-accent-ink underline underline-offset-2">
                      {r.item?.item_code} — {r.item?.description}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular text-bad font-medium">
                    {r.shortfall.toFixed(3)} {r.unit ?? r.item?.base_unit}
                  </td>
                  <td className="px-3 py-2 text-ink-soft text-xs">{r.jobList}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-ink-faint">
                    Koi raw material shortage nahi hai.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
