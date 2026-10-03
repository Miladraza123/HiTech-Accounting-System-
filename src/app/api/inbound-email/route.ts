import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, createHmac } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Inbound email intake (Phase 43, switched to Mailgun in Phase 43b). Mailgun
 * chosen over Postmark for its permanently-free tier (100 emails/day, 1
 * inbound route — Postmark's free tier is 100/MONTH). The user forwards
 * matching mail from their existing inbox (Gmail Settings -> Forwarding) to
 * the address Mailgun's Route gives them; no DNS/MX change on their own
 * domain either way.
 *
 * Mailgun's default Route delivery (no `.json` URL suffix) POSTs
 * multipart/form-data: `sender`/`from`/`subject`/`body-plain` as plain
 * fields, `attachment-count` + `attachment-<n>` as real file parts (not
 * base64) — see the Mailgun docs for "Routes forward() webhook fields".
 *
 * Gated two ways: the `?token=` shared secret (works for any provider,
 * matches this app's own convention), and — if
 * MAILGUN_WEBHOOK_SIGNING_KEY is configured — Mailgun's own HMAC-SHA256
 * signature (timestamp+token, keyed by the signing key, timing-safe
 * compared), which is optional but recommended since it also rules out a
 * stale/replayed delivery.
 */
function verifyMailgunSignature(timestamp: string, token: string, signature: string): boolean {
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (!signingKey) return true; // Not configured — the ?token= secret is the only gate, same as any other provider.
  const expected = createHmac("sha256", signingKey).update(timestamp + token).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const givenBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}

export async function POST(request: NextRequest) {
  const secret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  const token = request.nextUrl.searchParams.get("token");
  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data") && !contentType.includes("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "Expected a Mailgun form POST" }, { status: 400 });
  }

  const form = await request.formData();

  const mgTimestamp = String(form.get("timestamp") ?? "");
  const mgToken = String(form.get("token") ?? "");
  const mgSignature = String(form.get("signature") ?? "");
  if (mgTimestamp && mgToken && mgSignature && !verifyMailgunSignature(mgTimestamp, mgToken, mgSignature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const fromAddress = String(form.get("sender") ?? form.get("from") ?? "") || null;
  const subject = String(form.get("subject") ?? "") || null;
  const bodyText = String(form.get("body-plain") ?? "") || null;

  const admin = createAdminClient();
  const { data: doc, error } = await admin
    .from("incoming_documents")
    .insert({ source: "email", from_address: fromAddress, subject, body_text: bodyText })
    .select("id")
    .single();

  if (error || !doc) return NextResponse.json({ error: error?.message ?? "Failed to record document" }, { status: 500 });

  const attachmentCount = Number(form.get("attachment-count") ?? 0);
  for (let i = 1; i <= attachmentCount; i++) {
    const file = form.get(`attachment-${i}`);
    if (!(file instanceof File)) continue;
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `incoming/${doc.id}/${Date.now()}-${safeName}`;
      const bytes = Buffer.from(await file.arrayBuffer());
      const { error: uploadError } = await admin.storage.from("attachments").upload(path, bytes, { contentType: file.type || undefined });
      if (!uploadError) {
        await admin.from("incoming_document_attachments").insert({
          incoming_document_id: doc.id,
          file_name: file.name,
          storage_path: path,
          content_type: file.type || null,
          size_bytes: file.size || null,
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
