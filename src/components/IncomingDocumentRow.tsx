"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { markIncomingDocumentReviewedAction, dismissIncomingDocumentAction, getIncomingAttachmentUrlAction, trustSenderAction } from "@/app/actions/incomingDocuments";
import type { AgentData } from "@/lib/incomingAgent";
import { PoQuotationPicker } from "@/components/PoQuotationPicker";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";

const STATUS_STYLE: Record<string, string> = {
  New: "bg-warn-soft text-warn",
  Reviewed: "bg-ledger-soft text-ledger",
  Converted: "bg-good-soft text-good",
  Dismissed: "bg-surface-2 text-ink-faint",
};

export type IncomingDocumentData = {
  id: string;
  from_address: string | null;
  subject: string | null;
  body_text: string | null;
  status: string;
  received_at: string;
  attachments: { id: string; file_name: string; storage_path: string }[];
  // Phase 44 — filled only for emails delivered by the Email Agent (null/undefined for plain Mailgun mail).
  sender_name?: string | null;
  sender_email?: string | null;
  sender_trust?: string;
  doc_type?: string | null;
  ai_needs_review?: boolean;
  ai_data?: AgentData | null;
};

export function IncomingDocumentRow({ doc }: { doc: IncomingDocumentData }) {
  const router = useRouter();
  const { isOnline } = useOfflineQueue();
  const [expanded, setExpanded] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [showItems, setShowItems] = useState(false);
  const [showPoPicker, setShowPoPicker] = useState(false);
  const [pending, startTransition] = useTransition();

  const ai = doc.ai_data ?? null;
  const items = ai?.items ?? [];
  const summary = ai
    ? [
        ai.party_name,
        ai.reference_no ? `Ref ${ai.reference_no}` : null,
        ai.document_date,
        ai.total_amount != null ? `${ai.currency ?? ""} ${ai.total_amount.toLocaleString("en-PK")}`.trim() : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  function trust() {
    const email = doc.sender_email;
    if (!email) return;
    startTransition(async () => {
      await trustSenderAction(email);
      router.refresh();
    });
  }

  async function openAttachment(id: string, path: string) {
    setOpeningId(id);
    const url = await getIncomingAttachmentUrlAction(path);
    setOpeningId(null);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  function review() {
    startTransition(async () => {
      await markIncomingDocumentReviewedAction(doc.id);
      router.refresh();
    });
  }

  function dismiss() {
    startTransition(async () => {
      await dismissIncomingDocumentAction(doc.id);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink truncate">{doc.subject || "(No subject)"}</p>
          <p className="text-xs text-ink-faint">
            {doc.from_address} · {new Date(doc.received_at).toLocaleString("en-PK")}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {doc.doc_type && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-mono text-ink-soft whitespace-nowrap">{doc.doc_type}</span>}
          {doc.ai_needs_review && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs text-warn whitespace-nowrap">Needs review</span>}
          {doc.sender_trust === "untrusted" &&
            (doc.sender_email ? (
              <button
                type="button"
                onClick={trust}
                disabled={pending}
                title="Mark this sender as trusted"
                className="rounded-full bg-bad-soft px-2 py-0.5 text-xs text-bad whitespace-nowrap underline underline-offset-2 disabled:opacity-60"
              >
                Untrusted · Trust this sender
              </button>
            ) : (
              <span className="rounded-full bg-bad-soft px-2 py-0.5 text-xs text-bad whitespace-nowrap">Untrusted</span>
            ))}
          {doc.sender_trust === "trusted" && <span className="rounded-full bg-good-soft px-2 py-0.5 text-xs text-good whitespace-nowrap">Trusted</span>}
          <span className={`rounded-full px-2 py-0.5 text-xs font-mono whitespace-nowrap ${STATUS_STYLE[doc.status] ?? ""}`}>{doc.status}</span>
        </div>
      </div>

      {ai && (
        <div className="rounded-md border border-line bg-bg p-2 text-xs text-ink-soft space-y-1">
          {summary && <p className="text-ink">{summary}</p>}
          {!!ai.missing_fields?.length && <p className="text-warn">Missing: {ai.missing_fields.join(", ")}</p>}
          {items.length > 0 && (
            <button type="button" onClick={() => setShowItems((v) => !v)} className="text-accent-ink underline underline-offset-2">
              {showItems ? "Hide items" : `Show items (${items.length})`}
            </button>
          )}
          {showItems && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-ink-faint">
                    <th className="py-1 pr-2 font-normal">Description</th>
                    <th className="py-1 pr-2 font-normal text-right">Qty</th>
                    <th className="py-1 pr-2 font-normal text-right">Rate</th>
                    <th className="py-1 font-normal text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="border-t border-line align-top">
                      <td className="py-1 pr-2 text-ink">{it.description ?? "—"}</td>
                      <td className="py-1 pr-2 text-right whitespace-nowrap">{it.quantity != null ? `${it.quantity}${it.unit ? ` ${it.unit}` : ""}` : "—"}</td>
                      <td className="py-1 pr-2 text-right whitespace-nowrap">{it.unit_price != null ? it.unit_price.toLocaleString("en-PK") : "—"}</td>
                      <td className="py-1 text-right whitespace-nowrap">{it.amount != null ? it.amount.toLocaleString("en-PK") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showItems && ai.notes && <p className="whitespace-pre-wrap">{ai.notes}</p>}
        </div>
      )}

      {doc.body_text && (
        <button type="button" onClick={() => setExpanded((e) => !e)} className="text-xs text-accent-ink underline underline-offset-2">
          {expanded ? "Hide body" : "Show body"}
        </button>
      )}
      {expanded && doc.body_text && <p className="text-xs text-ink-soft whitespace-pre-wrap rounded-md bg-bg border border-line p-2">{doc.body_text}</p>}

      {!!doc.attachments.length && (
        <div className="flex flex-wrap gap-2">
          {doc.attachments.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => openAttachment(a.id, a.storage_path)}
              disabled={openingId === a.id}
              className="rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink-soft hover:bg-surface-2 disabled:opacity-60"
            >
              {openingId === a.id ? "…" : `📎 ${a.file_name}`}
            </button>
          ))}
        </div>
      )}

      {(doc.status === "New" || doc.status === "Reviewed") && (
        <div className="flex flex-wrap gap-2 pt-1">
          {doc.status === "New" && (
            <button type="button" onClick={review} disabled={pending} className="rounded-md border border-line bg-bg px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-2 disabled:opacity-60">
              Mark Reviewed
            </button>
          )}
          <Link href={`/queries/new?from=${doc.id}`} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
            Create Query from this
          </Link>
          {isOnline ? (
            <button
              type="button"
              onClick={() => setShowPoPicker((v) => !v)}
              className="rounded-md border border-line bg-bg px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-2"
            >
              PO Received — Link to Quotation
            </button>
          ) : (
            <span
              title="Linking a PO needs to be online — it carries this document's attachment over to the new Sales Order."
              className="rounded-md border border-line bg-bg px-3 py-1.5 text-xs text-ink-faint opacity-60 cursor-not-allowed"
            >
              PO Received — Link to Quotation
            </span>
          )}
          <button type="button" onClick={dismiss} disabled={pending} className="rounded-md border border-bad text-bad bg-bg px-3 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-60">
            Dismiss
          </button>
        </div>
      )}

      {showPoPicker && <PoQuotationPicker incomingDocumentId={doc.id} onClose={() => setShowPoPicker(false)} />}
    </div>
  );
}
