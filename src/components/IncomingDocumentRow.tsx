"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { markIncomingDocumentReviewedAction, dismissIncomingDocumentAction, getIncomingAttachmentUrlAction } from "@/app/actions/incomingDocuments";

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
};

export function IncomingDocumentRow({ doc }: { doc: IncomingDocumentData }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
        <span className={`rounded-full px-2 py-0.5 text-xs font-mono whitespace-nowrap ${STATUS_STYLE[doc.status] ?? ""}`}>{doc.status}</span>
      </div>

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
          <button type="button" onClick={dismiss} disabled={pending} className="rounded-md border border-bad text-bad bg-bg px-3 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-60">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
