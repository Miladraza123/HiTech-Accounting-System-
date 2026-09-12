import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export default async function ProductTemplatesPage() {
  const user = await getCurrentUser();
  const canCreate = await hasPermission(user, "product_template.manage");

  const supabase = await createClient();
  const { data: templates } = await supabase
    .from("product_templates")
    .select("*, items(item_code, description), product_template_lines(id)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">BOM / Product Templates</h1>
          <p className="mt-1 text-sm text-ink-soft">Repeat products ke liye reusable recipe — Job banate waqt select karen to material requirement khud ban jaye.</p>
        </div>
        {canCreate && (
          <Link href="/product-templates/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition">
            + Naya Template
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Code</th>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Output Item</th>
                <th className="text-right px-4 py-2.5">Material Lines</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {(templates ?? []).map((t) => {
                const outputItem = t.items as unknown as { item_code: string; description: string } | null;
                const lineCount = (t.product_template_lines as unknown as { id: string }[]).length;
                return (
                  <tr key={t.id} className="border-t border-line hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/product-templates/${t.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                        {t.template_code}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink">{t.name}</td>
                    <td className="px-4 py-2.5 text-ink-soft text-xs">{outputItem ? `${outputItem.item_code} — ${outputItem.description}` : "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink-soft">{lineCount}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${t.is_active ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"}`}>
                        {t.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!templates?.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                    Koi Template nahi hai abhi tak — repeat products ke liye bana lein.
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
