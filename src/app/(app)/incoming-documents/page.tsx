import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { IncomingDocumentRow, type IncomingDocumentData } from "@/components/IncomingDocumentRow";
import { IncomingDocumentsLive } from "@/components/IncomingDocumentsLive";
import type { AgentData } from "@/lib/incomingAgent";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";

export default async function IncomingDocumentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "sales"))) redirect("/");

  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  const { data: docs, count } = await supabase
    .from("incoming_documents")
    .select("*, incoming_document_attachments(id, file_name, storage_path)", { count: "exact" })
    .order("received_at", { ascending: false })
    .range(rangeFrom, rangeTo);
  const totalPages = computeTotalPages(count ?? 0);

  const rows: IncomingDocumentData[] = (docs ?? []).map((d) => ({
    id: d.id,
    from_address: d.from_address,
    subject: d.subject,
    body_text: d.body_text,
    status: d.status,
    received_at: d.received_at,
    attachments: (d.incoming_document_attachments ?? []) as unknown as { id: string; file_name: string; storage_path: string }[],
    sender_name: d.sender_name,
    sender_email: d.sender_email,
    sender_trust: d.sender_trust,
    doc_type: d.doc_type,
    ai_needs_review: d.ai_needs_review,
    ai_data: (d.ai_data ?? null) as unknown as AgentData | null,
  }));

  return (
    <div className="space-y-6">
      <IncomingDocumentsLive />
      <div>
        <h1 className="text-lg font-semibold text-ink">Incoming Documents</h1>
        <p className="mt-1 text-sm text-ink-soft">
          RFQ/PR/PO emails pulled in automatically — review, then create a Query with the subject/body and attachment carried over.
        </p>
      </div>

      <div className="space-y-3">
        {rows.map((doc) => (
          <IncomingDocumentRow key={doc.id} doc={doc} />
        ))}
        {!rows.length && (
          <div className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-ink-faint">
            Nothing has arrived yet. Once an inbound email provider is wired to this app&apos;s webhook, matching emails show up here.
          </div>
        )}
      </div>

      <PaginationControls basePath="/incoming-documents" searchParams={{}} currentPage={page} totalPages={totalPages} totalCount={count ?? 0} />
    </div>
  );
}
