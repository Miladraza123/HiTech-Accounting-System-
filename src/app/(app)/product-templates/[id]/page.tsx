import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function ProductTemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: template }, { data: lines }] = await Promise.all([
    supabase.from("product_templates").select("*, items(item_code, description)").eq("id", id).maybeSingle(),
    supabase.from("product_template_lines").select("*, items(item_code, description, base_unit)").eq("template_id", id).order("sort_order"),
  ]);

  if (!template) notFound();

  const outputItem = template.items as unknown as { item_code: string; description: string } | null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/product-templates" className="text-xs text-ink-faint hover:text-ink">
          ← BOM / Product Templates
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-ink font-mono">{template.template_code}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${template.is_active ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"}`}>
            {template.is_active ? "Active" : "Inactive"}
          </span>
        </div>
        <p className="text-sm text-ink-soft mt-0.5">{template.name}</p>
        {template.description && <p className="text-xs text-ink-faint mt-1">{template.description}</p>}
      </div>

      {outputItem && (
        <div className="text-sm text-ink-soft">
          Output: <span className="text-ink font-medium">{outputItem.item_code} — {outputItem.description}</span>{" "}
          {template.output_unit && <span className="text-ink-faint">({template.output_unit})</span>}
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Raw Material</th>
                <th className="text-right px-4 py-2.5">Qty per Unit</th>
                <th className="text-left px-4 py-2.5">Unit</th>
              </tr>
            </thead>
            <tbody>
              {(lines ?? []).map((l) => {
                const item = l.items as unknown as { item_code: string; description: string; base_unit: string } | null;
                return (
                  <tr key={l.id} className="border-t border-line">
                    <td className="px-4 py-2.5 text-ink">{item ? `${item.item_code} — ${item.description}` : "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink-soft">{l.qty_per_unit}</td>
                    <td className="px-4 py-2.5 text-ink-soft">{l.unit ?? item?.base_unit ?? "—"}</td>
                  </tr>
                );
              })}
              {!lines?.length && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-ink-faint">
                    No material lines.
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
