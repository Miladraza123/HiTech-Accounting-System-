import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { QueryForm } from "@/components/QueryForm";
import { requirementFromAgentData } from "@/lib/incomingAgent";

export default async function NewQueryPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "query.manage"))) redirect("/queries");

  const { from } = await searchParams;

  const supabase = await createClient();
  // Only the first page of clients, and only the two columns the picker
  // shows. Anything beyond this is found by typing, which searches in the
  // database — so this page no longer grows with the customer list.
  const [{ data: parties }, { data: sources }, { data: incomingDocument }] = await Promise.all([
    supabase.from("parties").select("id, legal_name").eq("is_active", true).order("legal_name").limit(20),
    supabase.from("query_sources").select("*").order("name"),
    // Only an un-converted document can still be turned into a Query —
    // otherwise `?from=` is stale (already used, or someone else's link).
    from
      ? supabase.from("incoming_documents").select("*").eq("id", from).in("status", ["New", "Reviewed"]).maybeSingle()
      : Promise.resolve({ data: null }),
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
        <QueryForm
          parties={parties}
          sources={sources ?? []}
          // The email body carries the actual ask (item list, quantities,
          // etc.) — the subject is often just a generic label ("RFQ",
          // "Query"). When the Email Agent already read the items out of the
          // email/attachment, Requirement is just that clean item list;
          // otherwise it defaults to the body, falling back to the subject only
          // when the body is empty, so the field a sales user actually reads
          // isn't blank or a one-word placeholder.
          initialRequirement={
            (requirementFromAgentData(incomingDocument?.ai_data) || incomingDocument?.body_text?.trim() || incomingDocument?.subject) ?? undefined
          }
          initialNotes={
            incomingDocument
              ? `From email: ${incomingDocument.from_address ?? ""}${incomingDocument.subject ? `\nSubject: ${incomingDocument.subject}` : ""}`.trim()
              : undefined
          }
          fromIncomingDocumentId={incomingDocument?.id}
        />
      )}
    </div>
  );
}
