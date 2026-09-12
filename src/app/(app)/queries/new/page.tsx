import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { QueryForm } from "@/components/QueryForm";

export default async function NewQueryPage() {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "query.manage"))) redirect("/queries");

  const supabase = await createClient();
  const [{ data: parties }, { data: sources }] = await Promise.all([
    supabase.from("parties").select("*").eq("is_active", true).order("legal_name"),
    supabase.from("query_sources").select("*").order("name"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/queries" className="text-xs text-ink-faint hover:text-ink">
          ← Queries
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">New Query</h1>
      </div>

      {!parties?.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          A client must exist first.{" "}
          <Link href="/clients" className="underline underline-offset-2 font-medium">
            Add Client
          </Link>
          .
        </div>
      ) : (
        <QueryForm parties={parties} sources={sources ?? []} />
      )}
    </div>
  );
}
