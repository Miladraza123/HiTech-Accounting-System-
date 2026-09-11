import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { NewQuotationForm } from "@/components/NewQuotationForm";

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ query_id?: string }>;
}) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "sales"))) redirect("/queries");

  const { query_id } = await searchParams;
  if (!query_id) redirect("/queries");

  const supabase = await createClient();
  const [{ data: query }, { data: items }, { data: units }, { data: company }] = await Promise.all([
    supabase.from("queries").select("id, query_no, requirement, parties(legal_name)").eq("id", query_id).maybeSingle(),
    supabase.from("items").select("*").eq("is_active", true).order("item_code"),
    supabase.from("units").select("*").order("code"),
    supabase.from("company").select("default_sales_tax_pct").maybeSingle(),
  ]);

  if (!query) notFound();
  const party = query.parties as unknown as { legal_name: string } | null;

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/queries/${query_id}`} className="text-xs text-ink-faint hover:text-ink">
          ← {query.query_no}
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Nayi Quotation</h1>
        <p className="text-sm text-ink-soft">
          {party?.legal_name} — {query.requirement}
        </p>
      </div>

      <NewQuotationForm
        queryId={query_id}
        items={items ?? []}
        units={units ?? []}
        defaultTaxPct={company?.default_sales_tax_pct ?? 18}
      />
    </div>
  );
}
