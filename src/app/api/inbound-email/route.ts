import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, createHmac } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { extractEmailAddress, parseAgentFields } from "@/lib/incomingAgent";

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
 * stale/replayed delivery. When the key is set, the signature fields are
 * required and the timestamp must be within the last 5 minutes.
 */
const SIGNATURE_MAX_AGE_SECONDS = 5 * 60;
const SIGNATURE_MAX_FUTURE_SECONDS = 60;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function verifyMailgunSignature(signingKey: string, timestamp: string, token: string, signature: string): boolean {
  // Mailgun's timestamp is Unix seconds; anything outside the window is a
  // stale or replayed delivery even if the HMAC itself is genuine.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Date.now() / 1000;
  if (ts < now - SIGNATURE_MAX_AGE_SECONDS || ts > now + SIGNATURE_MAX_FUTURE_SECONDS) return false;
  const expected = createHmac("sha256", signingKey).update(timestamp + token).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const givenBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}

/** Constant-time string compare that never throws on a length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function POST(request: NextRequest) {
  const secret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  const token = request.nextUrl.searchParams.get("token");
  if (!secret || !token || !safeEqual(token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data") && !contentType.includes("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "Expected a Mailgun form POST" }, { status: 400 });
  }

  const form = await request.formData();

  // Once a signing key is configured the signature is mandatory — a POST
  // that simply leaves the three fields out must not skip the check.
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (signingKey) {
    const mgTimestamp = String(form.get("timestamp") ?? "");
    const mgToken = String(form.get("token") ?? "");
    const mgSignature = String(form.get("signature") ?? "");
    if (!mgTimestamp || !mgToken || !mgSignature || !verifyMailgunSignature(signingKey, mgTimestamp, mgToken, mgSignature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const fromAddress = String(form.get("sender") ?? form.get("from") ?? "") || null;
  const subject = String(form.get("subject") ?? "") || null;
  const bodyText = String(form.get("body-plain") ?? "") || null;

  const admin = createAdminClient();

  // Phase 44: the external Email Agent adds structured `agent_*` fields. A plain
  // Mailgun delivery has none, so `agent` is null and everything below behaves
  // exactly as before.
  const agent = parseAgentFields(form);

  // Idempotent: if the agent retries a delivery that had already gone through
  // (e.g. the response was lost), return the existing row instead of a duplicate.
  if (agent) {
    const { data: existing } = await admin.from("incoming_documents").select("id").eq("agent_message_id", agent.messageId).maybeSingle();
    if (existing) return NextResponse.json({ ok: true, id: existing.id, duplicate: true });
  }

  // Nothing is ever dropped: unknown senders are accepted too, just flagged.
  // Trust is decided from Mailgun's own `sender`/`from` field, never from the
  // agent-supplied `agent_sender_email` — that one is free text the agent (or
  // anyone holding the webhook token) could set to a trusted address.
  const envelopeEmail = extractEmailAddress(form.get("sender")) ?? extractEmailAddress(form.get("from"));
  let senderTrust: "trusted" | "untrusted" | "unknown" = "unknown";
  if (agent) {
    senderTrust = "untrusted";
    if (envelopeEmail) {
      const { data: trusted } = await admin.from("trusted_senders").select("email").eq("email", envelopeEmail).maybeSingle();
      if (trusted) senderTrust = "trusted";
    }
  }

  const { data: doc, error } = await admin
    .from("incoming_documents")
    .insert({
      source: "email",
      from_address: fromAddress,
      subject,
      body_text: bodyText,
      ...(agent
        ? {
            agent_message_id: agent.messageId,
            sender_name: agent.senderName,
            sender_email: envelopeEmail ?? agent.senderEmail,
            doc_type: agent.docType,
            ai_data: agent.data as unknown as Json | null,
            ai_needs_review: agent.needsReview,
            sender_trust: senderTrust,
          }
        : {}),
    })
    .select("id")
    .single();

  // Two deliveries of the same agent message racing each other: the unique index wins.
  if (error && agent && error.code === "23505") {
    const { data: existing } = await admin.from("incoming_documents").select("id").eq("agent_message_id", agent.messageId).maybeSingle();
    if (existing) return NextResponse.json({ ok: true, id: existing.id, duplicate: true });
  }

  if (error || !doc) return NextResponse.json({ error: error?.message ?? "Failed to record document" }, { status: 500 });

  // Capped so one oversized delivery can't fill the storage bucket; anything
  // beyond the cap is skipped (the email itself is still recorded).
  const rawCount = Number(form.get("attachment-count") ?? 0);
  const attachmentCount = Number.isFinite(rawCount) ? Math.min(Math.max(0, Math.floor(rawCount)), MAX_ATTACHMENTS) : 0;
  for (let i = 1; i <= attachmentCount; i++) {
    const file = form.get(`attachment-${i}`);
    if (!(file instanceof File)) continue;
    if (file.size > MAX_ATTACHMENT_BYTES) continue;
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
