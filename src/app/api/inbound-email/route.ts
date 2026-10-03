import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Inbound email intake (Phase 43). Written for Postmark's Inbound webhook
 * payload shape — chosen because it needs zero DNS/MX changes on the
 * user's existing domain: Postmark hands out a ready
 * `<hash>@inbound.postmarkapp.com` address immediately, and the user just
 * adds a forwarding rule in their existing inbox (e.g. Gmail Settings ->
 * Forwarding) for the RFQ/PR/PO mail they want captured. No inbound-email
 * infrastructure existed anywhere in this app before this phase.
 *
 * Unauthenticated by nature (the email provider calls this, not a
 * signed-in user) — gated instead by a shared secret in the URL, and
 * writes through the admin client since there is no end-user session to
 * carry RLS. Configure the webhook URL in Postmark as:
 *   https://<your-app>/api/inbound-email?token=<INBOUND_EMAIL_WEBHOOK_SECRET>
 */
export async function POST(request: NextRequest) {
  const secret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  const token = request.nextUrl.searchParams.get("token");
  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const fromAddress: string | null = body.FromFull?.Email ?? body.From ?? null;
  const subject: string | null = body.Subject ?? null;
  const bodyText: string | null = body.TextBody ?? body.HtmlBody ?? null;
  const attachments: { Name: string; Content: string; ContentType: string; ContentLength: number }[] = body.Attachments ?? [];

  const admin = createAdminClient();
  const { data: doc, error } = await admin
    .from("incoming_documents")
    .insert({ source: "email", from_address: fromAddress, subject, body_text: bodyText })
    .select("id")
    .single();

  if (error || !doc) return NextResponse.json({ error: error?.message ?? "Failed to record document" }, { status: 500 });

  for (const att of attachments) {
    try {
      const safeName = att.Name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `incoming/${doc.id}/${Date.now()}-${safeName}`;
      const bytes = Buffer.from(att.Content, "base64");
      const { error: uploadError } = await admin.storage.from("attachments").upload(path, bytes, { contentType: att.ContentType || undefined });
      if (!uploadError) {
        await admin.from("incoming_document_attachments").insert({
          incoming_document_id: doc.id,
          file_name: att.Name,
          storage_path: path,
          content_type: att.ContentType || null,
          size_bytes: att.ContentLength || null,
        });
      }
    } catch {
      // One bad attachment must never lose the email itself — the staff
      // reviewing it still sees the subject/body and can ask the sender
      // to resend the file if it's missing.
    }
  }

  return NextResponse.json({ ok: true, id: doc.id });
}
