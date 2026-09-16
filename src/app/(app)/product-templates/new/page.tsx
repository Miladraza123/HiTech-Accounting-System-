import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchLineItems } from "@/lib/itemOptions";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NewProductTemplateForm } from "@/components/NewProductTemplateForm";

export default async function NewProductTemplatePage() {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "product_template.manage"))) redirect("/product-templates");

  const supabase = await createClient();
  const [items, { data: units }, { data: altUnits }] = await Promise.all([
    fetchLineItems(supabase),
    supabase.from("units").select("*").order("code"),
    supabase.from("item_alt_units").select("*").eq("is_active", true),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/product-templates" className="text-xs text-ink-faint hover:text-ink">
          ← BOM / Product Templates
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">New BOM Template</h1>
      </div>

      {!items?.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          At least one item must exist in the Item Master first.{" "}
          <Link href="/items" className="underline underline-offset-2 font-medium">
            Add an Item
          </Link>
          .
        </div>
      ) : (
        <NewProductTemplateForm items={items} units={units ?? []} altUnits={altUnits ?? []} />
      )}
    </div>
  );
}
