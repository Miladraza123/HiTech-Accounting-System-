import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Converting an Incoming Document (email RFQ/PR/PO — see
 * src/app/api/inbound-email/route.ts) into a Query or Sales Order: claims the
 * document, then carries its attachment(s) over by copying the actual
 * storage object, not re-uploading.
 *
 * `from_incoming_document_id` comes from the browser, so it is checked with
 * the CALLER's own client first — the document must exist, be visible to
 * them under incoming_documents' RLS (Owner/Sales), and not already be
 * Converted or Dismissed. The claim itself is a conditional update, so two
 * conversions racing each other can't both copy the attachments. Only after
 * that does the admin client touch storage: the source objects live under
 * "incoming/...", a prefix the attachments bucket's own RLS
 * (fn_can_access_doc_type) was never taught to recognize.
 *
 * Best-effort throughout — a failure here must never lose the Query/Sales
 * Order the caller just saved.
 */
export async function convertIncomingDocument(
  supabase: ServerClient,
  opts: {
    incomingDocumentId: string;
    ownerTable: "queries" | "sales_orders";
    ownerId: string;
    userId: string | null | undefined;
  }
): Promise<void> {
  const { incomingDocumentId, ownerTable, ownerId, userId } = opts;

  const { data: doc } = await supabase.from("incoming_documents").select("id, status").eq("id", incomingDocumentId).maybeSingle();
  if (!doc || doc.status === "Converted" || doc.status === "Dismissed") return;

  const link = ownerTable === "queries" ? { converted_query_id: ownerId } : { converted_sales_order_id: ownerId };
  const { data: claimed } = await supabase
    .from("incoming_documents")
    .update({ status: "Converted", ...link })
    .eq("id", incomingDocumentId)
    .neq("status", "Converted")
    .neq("status", "Dismissed")
    .select("id");
  if (!claimed?.length) return;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return;
  }
  const { data: incomingAttachments } = await admin
    .from("incoming_document_attachments")
    .select("file_name, storage_path, content_type")
    .eq("incoming_document_id", incomingDocumentId);
  for (const att of incomingAttachments ?? []) {
    const safeName = att.file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const newPath = `${ownerTable}/${ownerId}/${Date.now()}-${safeName}`;
    const { error: copyError } = await admin.storage.from("attachments").copy(att.storage_path, newPath);
    if (!copyError) {
      await admin.from("attachments").insert({
        owner_table: ownerTable,
        owner_id: ownerId,
        file_path: newPath,
        file_type: att.content_type,
        label: null,
        uploaded_by: userId,
      });
    }
  }
}
