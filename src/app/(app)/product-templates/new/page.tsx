import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { NewProductTemplateForm } from "@/components/NewProductTemplateForm";

export default async function NewProductTemplatePage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "production"))) redirect("/product-templates");

  const supabase = await createClient();
  const [{ data: items }, { data: units }] = await Promise.all([
    supabase.from("items").select("*").eq("is_active", true).order("item_code"),
    supabase.from("units").select("*").order("code"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/product-templates" className="text-xs text-ink-faint hover:text-ink">
          ← BOM / Product Templates
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Naya BOM Template</h1>
      </div>

      {!items?.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          Pehle Item Master mein kam az kam ek item hona chahiye.{" "}
          <Link href="/items" className="underline underline-offset-2 font-medium">
            Item add karen
          </Link>
          .
        </div>
      ) : (
        <NewProductTemplateForm items={items} units={units ?? []} />
      )}
    </div>
  );
}
